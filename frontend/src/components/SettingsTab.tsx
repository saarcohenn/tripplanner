import { useEffect, useState } from "react";
import { api } from "../api";
import type { Settings } from "../types";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI (ChatGPT)" },
  { id: "gemini", label: "Google (Gemini)" },
  { id: "openrouter", label: "OpenRouter" },
];

export default function SettingsTab({ settings, reload }: { settings: Settings | null; reload: () => Promise<void> }) {
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [autoReplan, setAutoReplan] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.llm_provider || "anthropic");
    setApiKey(settings.llm_api_key || "");
    setModel(settings.llm_model || "");
    setAutoReplan(settings.auto_replan === "1");
  }, [settings]);

  async function save() {
    await api.put("/settings", {
      llm_provider: provider,
      llm_api_key: apiKey,
      llm_model: model || (settings?.default_models?.[provider] ?? ""),
      auto_replan: autoReplan ? "1" : "0",
    });
    await reload();
    setStatus("Saved.");
  }

  async function test() {
    setTesting(true);
    setStatus(null);
    try {
      const r = await api.post<{ ok: boolean; model: string; reply: string }>("/settings/test");
      setStatus(`✅ Connected — ${r.model} replied "${r.reply}"`);
    } catch (e: any) {
      setStatus(`❌ ${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="pad narrow">
      <h2>LLM connection</h2>
      <p className="hint">
        Your key is stored only in this app's own database on your server and used server-side to call the
        provider. It is never sent anywhere else.
      </p>
      <label className="block">Provider
        <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(""); }}>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <label className="block">API key
        <input
          type="password"
          placeholder={provider === "anthropic" ? "sk-ant-…" : provider === "openrouter" ? "sk-or-…" : "sk-…"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <label className="block">Model <span className="hint">(default: {settings?.default_models?.[provider]})</span>
        <input placeholder={settings?.default_models?.[provider]} value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <label className="block row">
        <input type="checkbox" checked={autoReplan} onChange={(e) => setAutoReplan(e.target.checked)} />
        Auto-replan: regenerate the daily plan automatically a few seconds after the trip changes
      </label>
      <div className="row">
        <button className="primary" onClick={save}>Save</button>
        <button onClick={test} disabled={testing}>{testing ? "Testing…" : "Test connection"}</button>
      </div>
      {status && <p dir="auto">{status}</p>}
    </div>
  );
}

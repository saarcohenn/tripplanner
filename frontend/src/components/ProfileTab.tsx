import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { api } from "../api";
import type { LlmDefaults, LlmUsage, ProviderPlan, User } from "../types";
import CurrencySelect from "./CurrencySelect";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI (ChatGPT)" },
  { id: "gemini", label: "Google (Gemini)" },
  { id: "openrouter", label: "OpenRouter" },
];

function fmtUsd(v: number): string {
  return "$" + (v > 0 && v < 0.01 ? v.toFixed(4) : v.toFixed(2));
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function UsageSection({ usage, priceIn, setPriceIn, priceOut, setPriceOut, monthlyBudget, setMonthlyBudget }: {
  usage: LlmUsage | null;
  priceIn: string; setPriceIn: (v: string) => void;
  priceOut: string; setPriceOut: (v: string) => void;
  monthlyBudget: string; setMonthlyBudget: (v: string) => void;
}) {
  const [plan, setPlan] = useState<ProviderPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [checkingPlan, setCheckingPlan] = useState(false);

  async function checkPlan(silent = false) {
    setCheckingPlan(true);
    setPlanError(null);
    try {
      setPlan(await api.get<ProviderPlan>("/llm/provider-plan"));
    } catch (e: any) {
      setPlan(null);
      // On auto-load, stay quiet (e.g. provider without a billing API, or no key yet).
      if (!silent) setPlanError(e.message);
    } finally {
      setCheckingPlan(false);
    }
  }

  useEffect(() => { void checkPlan(true); }, []);
  const pin = parseFloat(priceIn) || 0;
  const pout = parseFloat(priceOut) || 0;
  const budget = parseFloat(monthlyBudget) || 0;
  const hasPrices = pin > 0 || pout > 0;
  const monthCost = usage ? (usage.month.input_tokens / 1e6) * pin + (usage.month.output_tokens / 1e6) * pout : 0;
  const maxDay = Math.max(1, ...(usage?.days || []).map((d) => d.input_tokens + d.output_tokens));

  // Budget basis: a key spending limit if one is set, otherwise the account's prepaid credits.
  const planBudget = !plan
    ? null
    : plan.key_limit_usd != null && plan.key_limit_usd > 0
      ? { used: plan.key_usage_usd, total: plan.key_limit_usd, label: "key spending limit" }
      : plan.account_credits_usd != null && plan.account_credits_usd > 0
        ? { used: plan.account_usage_usd ?? 0, total: plan.account_credits_usd, label: "account credits" }
        : null;
  const planPct = planBudget ? (planBudget.used / planBudget.total) * 100 : null;
  const fmtPct = (p: number) => (p >= 1 || p === 0 ? p.toFixed(0) : p.toFixed(2)) + "%";

  return (
    <>
      <div className="row spread">
        <h2>LLM usage &amp; billing</h2>
        <button onClick={() => checkPlan()} disabled={checkingPlan}>
          {checkingPlan ? "Checking…" : "Check provider plan"}
        </button>
      </div>
      {planError && <div className="alert">{planError}</div>}
      {plan && (
        <div className="plan-card">
          <div>
            <strong>OpenRouter key{plan.label ? ` "${plan.label}"` : ""}</strong>
            {plan.is_free_tier && <span className="chip" style={{ marginLeft: 8 }}>free tier</span>}
          </div>
          {planBudget && planPct != null ? (
            <>
              <div className="plan-pct-row">
                <span className="exp-num">{fmtPct(planPct)}</span>
                <span className="hint">
                  of {planBudget.label} used — {fmtUsd(planBudget.used)} of {fmtUsd(planBudget.total)},
                  {" "}{fmtUsd(planBudget.total - planBudget.used)} left
                </span>
              </div>
              <div className="budget-bar">
                <div
                  className={`budget-fill ${planPct > 100 ? "over" : ""}`}
                  style={{ width: `${Math.min(100, Math.max(planPct, planBudget.used > 0 ? 0.7 : 0))}%` }}
                />
              </div>
            </>
          ) : (
            <p className="hint">Spent {fmtUsd(plan.key_usage_usd)} — no spending limit or prepaid credits set on this key, so there is no percentage to show. Set a key limit in the OpenRouter dashboard to get a progress bar.</p>
          )}
        </div>
      )}
      {!usage || usage.totals.calls === 0 ? (
        <p className="hint">No LLM calls recorded yet — usage appears here after you generate a plan, import a conversation or run a test.</p>
      ) : (
        <>
          <p className="hint">
            This month: <strong>{usage.month.calls}</strong> calls, {fmtTokens(usage.month.input_tokens)} in / {fmtTokens(usage.month.output_tokens)} out
            {hasPrices && <> ≈ <strong>${monthCost.toFixed(2)}</strong></>}
            {" · "}all time: {usage.totals.calls} calls, {fmtTokens(usage.totals.input_tokens)} in / {fmtTokens(usage.totals.output_tokens)} out
          </p>
          {hasPrices && budget > 0 && (
            <>
              <div className="budget-bar">
                <div className={`budget-fill ${monthCost > budget ? "over" : ""}`} style={{ width: `${Math.min(100, (monthCost / budget) * 100)}%` }} />
              </div>
              <p className="hint">{((monthCost / budget) * 100).toFixed(0)}% of ${budget.toFixed(2)} monthly LLM budget{monthCost > budget && <strong className="over-text"> — over budget!</strong>}</p>
            </>
          )}
          <div className="usage-chart">
            {usage.days.map((d) => (
              <div key={d.day} className="usage-col" title={`${d.day}: ${d.calls} calls, ${fmtTokens(d.input_tokens)} in / ${fmtTokens(d.output_tokens)} out`}>
                <div className="usage-bar out" style={{ height: `${(d.output_tokens / maxDay) * 100}%` }} />
                <div className="usage-bar in" style={{ height: `${(d.input_tokens / maxDay) * 100}%` }} />
                <span className="usage-day">{d.day.slice(8)}</span>
              </div>
            ))}
          </div>
          <p className="hint"><span className="dot" style={{ background: "var(--accent)" }} /> input tokens <span className="dot" style={{ background: "var(--olive)", marginLeft: 10 }} /> output tokens — last 30 days</p>
          <details>
            <summary className="hint">Recent calls</summary>
            <table className="table">
              <tbody>
                {usage.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="hint nowrap">{r.ts.slice(5, 16)}</td>
                    <td>{r.purpose}</td>
                    <td className="hint">{r.model}</td>
                    <td className="nowrap">{fmtTokens(r.input_tokens)} in / {fmtTokens(r.output_tokens)} out</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      <div className="row wrap">
        <label className="block">$ / 1M input tokens
          <input type="number" step="0.01" placeholder="e.g. 0.30" value={priceIn} onChange={(e) => setPriceIn(e.target.value)} />
        </label>
        <label className="block">$ / 1M output tokens
          <input type="number" step="0.01" placeholder="e.g. 2.50" value={priceOut} onChange={(e) => setPriceOut(e.target.value)} />
        </label>
        <label className="block">Monthly LLM budget ($)
          <input type="number" step="0.5" placeholder="e.g. 5" value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} />
        </label>
      </div>
      <p className="hint">Token counts are exact (reported by the provider per call); cost is estimated from the prices you enter — check your provider's pricing page for your model's rates. Free-tier Gemini: leave prices empty.</p>
    </>
  );
}

export default function ProfileTab({ currentUser, onUserUpdate, logout }: {
  currentUser: User;
  onUserUpdate: (user: User) => void;
  logout: () => Promise<void>;
}) {
  const [defaults, setDefaults] = useState<LlmDefaults | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [autoReplan, setAutoReplan] = useState(false);
  const [homeCurrency, setHomeCurrency] = useState("USD");
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [manualModel, setManualModel] = useState(false);
  const [usage, setUsage] = useState<LlmUsage | null>(null);
  const [priceIn, setPriceIn] = useState("");
  const [priceOut, setPriceOut] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState("");
  const [planSystemPrompt, setPlanSystemPrompt] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    api.get<LlmDefaults>("/llm/defaults").then(setDefaults).catch(() => {});
    api.get<LlmUsage>("/llm/usage").then(setUsage).catch(() => {});
  }, []);

  useEffect(() => {
    setProvider(currentUser.llm_provider || "anthropic");
    setApiKey(currentUser.llm_api_key || "");
    setModel(currentUser.llm_model || "");
    setAutoReplan(currentUser.auto_replan === "1");
    setPriceIn(currentUser.llm_price_in || "");
    setPriceOut(currentUser.llm_price_out || "");
    setMonthlyBudget(currentUser.llm_monthly_budget || "");
    setHomeCurrency(currentUser.home_currency || "USD");
    setPlanSystemPrompt(currentUser.plan_system_prompt || "");
    setDisplayName(currentUser.display_name || "");
  }, [currentUser]);

  async function loadModels() {
    setLoadingModels(true);
    setStatus(null);
    try {
      const r = await api.post<{ models: string[] }>("/llm/models", { provider, api_key: apiKey });
      setModelList(r.models);
      setManualModel(false);
      // Keep state in sync with what the dropdown will display — otherwise Save
      // stores a stale/default model even though the UI shows a valid one.
      if (r.models.length > 0 && !r.models.includes(model)) {
        const def = defaults?.default_models?.[provider];
        setModel(def && r.models.includes(def) ? def : r.models[0]);
      }
      if (r.models.length === 0) setStatus("Provider returned no models for this key.");
    } catch (e: any) {
      setStatus(`${e.message}`);
    } finally {
      setLoadingModels(false);
    }
  }

  async function save() {
    const r = await api.put<{ user: User }>("/profile", {
      display_name: displayName,
      llm_provider: provider,
      llm_api_key: apiKey,
      llm_model: model || (defaults?.default_models?.[provider] ?? ""),
      auto_replan: autoReplan ? "1" : "0",
      llm_price_in: priceIn,
      llm_price_out: priceOut,
      llm_monthly_budget: monthlyBudget,
      home_currency: homeCurrency,
      plan_system_prompt: planSystemPrompt,
    });
    onUserUpdate(r.user);
    setStatus("Saved.");
  }

  // Save is the one button that writes everything on this page, so a rejected name (blank, too
  // long, already taken) has to surface rather than becoming an unhandled rejection.
  async function saveAll() {
    setStatus(null);
    try {
      await save();
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function test() {
    setTesting(true);
    setStatus(null);
    try {
      // Test what's on screen, not what was saved earlier.
      await save();
      const r = await api.post<{ ok: boolean; model: string; reply: string }>("/settings/test");
      setStatus(`Connected — ${r.model} replied "${r.reply}"`);
    } catch (e: any) {
      setStatus(`${e.message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="pad narrow">
      <div className="row spread">
        <h2>Profile</h2>
        <button className="btn-icon" onClick={logout}><LogOut size={14} /> Log out</button>
      </div>
      <label className="block">Display name
        <input
          dir="auto" maxLength={40} placeholder={currentUser.email}
          value={displayName} onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <p className="hint" dir="auto">
        What you're called in the sidebar, on shared trips, and in room invites — which is why it has
        to be yours alone. Saved with everything else at the bottom of this page.
      </p>
      <p className="hint" dir="auto">{currentUser.email} · {currentUser.role}</p>

      <h2>LLM connection</h2>
      <p className="hint">
        Your key is stored only in this app's own database on your server and used server-side to call the
        provider. It is never sent anywhere else.
      </p>
      <label className="block">Provider
        <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(""); setModelList([]); }}>
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
      <label className="block">Model <span className="hint">(default: {defaults?.default_models?.[provider]})</span>
        {modelList.length > 0 && !manualModel ? (
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {model && !modelList.includes(model) && <option value={model}>{model} (current)</option>}
            {modelList.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input placeholder={defaults?.default_models?.[provider]} value={model} onChange={(e) => setModel(e.target.value)} />
        )}
      </label>
      <div className="row">
        <button className="small" onClick={loadModels} disabled={loadingModels}>
          {loadingModels ? "Loading…" : "Load model list"}
        </button>
        {modelList.length > 0 && (
          <button className="small" onClick={() => setManualModel(!manualModel)}>
            {manualModel ? "Choose from list" : "Type manually"}
          </button>
        )}
      </div>
      <label className="block row">
        <input type="checkbox" checked={autoReplan} onChange={(e) => setAutoReplan(e.target.checked)} />
        Auto-replan: regenerate the daily plan automatically a few seconds after the trip changes
      </label>

      <div className="row spread">
        <h2>Plan generation prompt</h2>
        {defaults?.default_plan_system_prompt && planSystemPrompt !== defaults.default_plan_system_prompt && (
          <button className="small" onClick={() => setPlanSystemPrompt(defaults.default_plan_system_prompt)}>
            Reset to default
          </button>
        )}
      </div>
      <p className="hint">
        The system prompt sent to your LLM every time a plan is generated. Edit it to change tone, add
        constraints (dietary needs, mobility, pacing preference), or adjust the level of detail — it still
        gets your trip's legs, places and bookings as the actual content to schedule.
      </p>
      <textarea rows={10} value={planSystemPrompt} onChange={(e) => setPlanSystemPrompt(e.target.value)} />

      <h2>Money</h2>
      <label className="block">Home currency
        <CurrencySelect value={homeCurrency} onChange={setHomeCurrency} />
      </label>
      <p className="hint">
        All expenses and bookings — whatever currency you paid in — are converted to this currency
        in the Expenses summary, so you always see your spending against the budget in the money you think in.
      </p>

      <UsageSection
        usage={usage}
        priceIn={priceIn} setPriceIn={setPriceIn}
        priceOut={priceOut} setPriceOut={setPriceOut}
        monthlyBudget={monthlyBudget} setMonthlyBudget={setMonthlyBudget}
      />

      <div className="row">
        <button className="primary" onClick={saveAll}>Save</button>
        <button onClick={test} disabled={testing}>{testing ? "Testing…" : "Test LLM connection"}</button>
      </div>
      {status && <p dir="auto">{status}</p>}
    </div>
  );
}

import { getSetting } from "./db.js";

export type LlmConfig = {
  provider: "anthropic" | "openai" | "gemini" | "openrouter";
  apiKey: string;
  model: string;
};

export const DEFAULT_MODELS: Record<LlmConfig["provider"], string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o",
  gemini: "gemini-2.5-flash",
  openrouter: "anthropic/claude-sonnet-4.5",
};

export function loadLlmConfig(): LlmConfig {
  const provider = (getSetting("llm_provider") || "anthropic") as LlmConfig["provider"];
  const apiKey = getSetting("llm_api_key") || "";
  const model = getSetting("llm_model") || DEFAULT_MODELS[provider] || DEFAULT_MODELS.anthropic;
  if (!apiKey) {
    const err: any = new Error(
      "No LLM API key configured. Open Settings and add your provider + API key."
    );
    err.status = 400;
    throw err;
  }
  return { provider, apiKey, model };
}

/** Send a single-turn prompt to the configured provider, return raw text. */
export async function complete(system: string, user: string, cfg?: LlmConfig): Promise<string> {
  const c = cfg || loadLlmConfig();
  switch (c.provider) {
    case "anthropic": {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": c.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: c.model,
          max_tokens: 8192,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      const data: any = await parseOrThrow(res, "Anthropic");
      return (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
    }
    case "openai":
    case "openrouter": {
      const base =
        c.provider === "openai"
          ? "https://api.openai.com/v1/chat/completions"
          : "https://openrouter.ai/api/v1/chat/completions";
      const res = await fetch(base, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${c.apiKey}`,
        },
        body: JSON.stringify({
          model: c.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      const data: any = await parseOrThrow(res, c.provider === "openai" ? "OpenAI" : "OpenRouter");
      return data.choices?.[0]?.message?.content ?? "";
    }
    case "gemini": {
      // Accept both "gemini-2.5-flash" and "models/gemini-2.5-flash".
      const model = c.model.replace(/^models\//, "");
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          model
        )}:generateContent`,
        {
          method: "POST",
          // New-format Gemini keys (AQ.…) only work via this header, not the legacy ?key= param.
          headers: { "content-type": "application/json", "x-goog-api-key": c.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
          }),
        }
      );
      const data: any = await parseOrThrow(res, "Gemini");
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || [])
        .filter((p: any) => !p.thought)
        .map((p: any) => p.text || "")
        .join("");
      if (!text) {
        const why = cand?.finishReason || data.promptFeedback?.blockReason || "no candidates returned";
        throw Object.assign(
          new Error(`Gemini returned an empty reply (${why}). Raw: ${JSON.stringify(data).slice(0, 300)}`),
          { status: 502 }
        );
      }
      return text;
    }
    default:
      throw new Error(`Unknown provider: ${(c as any).provider}`);
  }
}

/** List chat-capable model ids for a provider, newest-ish first. */
export async function listModels(provider: LlmConfig["provider"], apiKey: string): Promise<string[]> {
  switch (provider) {
    case "anthropic": {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      });
      const data: any = await parseOrThrow(res, "Anthropic");
      return (data.data || []).map((m: any) => m.id);
    }
    case "openai": {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${apiKey}` },
      });
      const data: any = await parseOrThrow(res, "OpenAI");
      return (data.data || [])
        .map((m: any) => String(m.id))
        .filter(
          (id: string) =>
            /^(gpt-|o\d|chatgpt)/.test(id) &&
            !/embed|audio|tts|whisper|dall|realtime|transcribe|moderation|image|search/.test(id)
        )
        .sort()
        .reverse();
    }
    case "gemini": {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", {
        headers: { "x-goog-api-key": apiKey },
      });
      const data: any = await parseOrThrow(res, "Gemini");
      return (data.models || [])
        .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m: any) => String(m.name).replace(/^models\//, ""))
        .filter((id: string) => id.startsWith("gemini"))
        .sort()
        .reverse();
    }
    case "openrouter": {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { authorization: `Bearer ${apiKey}` },
      });
      const data: any = await parseOrThrow(res, "OpenRouter");
      return (data.data || []).map((m: any) => String(m.id)).sort();
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function parseOrThrow(res: Response, providerName: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    const err: any = new Error(`${providerName} API error (${res.status}): ${text.slice(0, 500)}`);
    err.status = 502;
    throw err;
  }
  return JSON.parse(text);
}

/** Extract the first JSON object/array from an LLM reply (handles code fences and prose). */
export function extractJson<T = any>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("LLM reply contained no JSON: " + text.slice(0, 300));
  // Walk the string to find the matching close bracket, respecting strings.
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error("Unbalanced JSON in LLM reply: " + candidate.slice(start, start + 300));
}

import {
  bluePassRouterActions,
  parseBluePassRouterDecision,
  type BluePassRouterDecision,
  type BluePassRouterInput,
  type BluePassRouterLlmClient
} from "@/core/llm/bluepass-router";
import { getKaiLlmRuntimeSettings } from "@/server/config/kai-environment";
import { logBluePassLlmUsage, type BluePassLlmProvider } from "./bluepass-llm-usage";

type Fetcher = typeof fetch;

export type BluePassRouterEnvironment = Record<string, string | undefined>;

const defaultRouterTimeoutMs = 2500;
const defaultRouterMaxOutputTokens = 220;

const systemPrompt = [
  "You are the routing brain for Kai, BluePass's WhatsApp yacht charter concierge for Komodo and Raja Ampat, Indonesia.",
  "Classify the traveller's latest message into exactly one action and extract any trip details they stated.",
  "Allowed action values:",
  "- VALUE_QUESTION: asking what BluePass is, why use it, fees, or the direct-booking value proposition",
  "- SMALL_TALK: greeting, thanks, or generic chit-chat with no travel/commercial intent",
  "- SEASON_QUESTION: asking about the best time/season/month to visit Komodo or Raja Ampat",
  "- DESTINATION_COMPARISON: comparing Komodo vs Raja Ampat",
  "- YACHT_COMPARISON: comparing two or more specific yachts already mentioned in this conversation",
  "- YACHT_INFO: asking for details about one specific yacht already mentioned or selected",
  "- RECOMMENDATION: asking for yacht/trip recommendations, options, or alternatives, or browsing by destination",
  "- TRAVEL_INSPIRATION: undecided on destination, describing a mood or occasion (honeymoon, relax, family) and wants inspiration",
  "- GENERAL_QUESTION: any other genuine travel, destination, or logistics question, including topics outside BluePass's catalog (other islands, visas, weather, diving certification, etc). Answer these like a knowledgeable, well-travelled Indonesia concierge.",
  "- BROWSE_OPTIONS: traveller is still exploring or has not committed to sending an inquiry yet, even if some trip details are known",
  "- REQUEST_MISSING_FIELDS: traveller has shown real booking intent (explicit booking language, or has picked a specific yacht) but required trip or contact details are still missing",
  "- CONFIRM_INQUIRY: all required details are known and the traveller has not yet explicitly confirmed sending the inquiry",
  "- SUBMIT_INQUIRY: traveller clearly wants to send/submit/confirm the operator inquiry now (explicit booking confirmation, or a bare yes/ok/proceed confirming a previously offered inquiry)",
  "Also extract, only if explicitly present in the traveller's OWN words this message or clearly reconfirmed: destination, dateWindow, guests (integer), budget, interests (short tags), tripType.",
  "Never invent or guess facts. Do not extract travellerName, travellerEmail, or travellerPhone - leave those out entirely, another deterministic system handles contact details.",
  "Respond with a single compact JSON object only, no prose, no markdown fences. Example: {\"action\":\"RECOMMENDATION\",\"destination\":\"Komodo\",\"guests\":4}"
].join("\n");

function buildUserPrompt(input: BluePassRouterInput) {
  const history = input.priorTravellerMessages.slice(-6).join("\n") || "No prior traveller messages.";
  const known = input.knownIntent;

  return [
    "Known trip details so far:",
    `- Destination: ${known.destination ?? "unknown"}`,
    `- Date window: ${known.dateWindow ?? "unknown"}`,
    `- Guests: ${known.guests ?? "unknown"}`,
    `- Budget: ${known.budget ?? "unknown"}`,
    `- Missing required fields: ${input.missingFields.join(", ") || "none"}`,
    `- A specific yacht is currently selected: ${input.hasSelectedYacht ? "yes" : "no"}`,
    `- Yachts mentioned in this conversation: ${input.mentionedYachtNames.join(", ") || "none"}`,
    "",
    "Prior traveller messages (most recent last):",
    history,
    "",
    "Latest traveller message: " + input.latestMessage,
    "",
    "Allowed action values: " + bluePassRouterActions.join(", "),
    "",
    "Respond with JSON only."
  ].join("\n");
}

async function callChatCompletionRouter(input: {
  url: string;
  apiKey: string;
  provider: BluePassLlmProvider;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  routerInput: BluePassRouterInput;
  fetcher: Fetcher;
}): Promise<BluePassRouterDecision> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), input.timeoutMs);

  try {
    const response = await input.fetcher(input.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + input.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildUserPrompt(input.routerInput) }
        ],
        max_tokens: input.maxOutputTokens,
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
      signal: abortController.signal
    });

    if (!response.ok) {
      throw new Error("BluePass router LLM call failed.");
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("BluePass router LLM returned empty text.");
    }

    const decision = parseBluePassRouterDecision(text);
    if (!decision) {
      throw new Error("BluePass router LLM returned an unparseable decision.");
    }

    if (payload.usage) {
      logBluePassLlmUsage({
        callType: "router",
        provider: input.provider,
        model: input.model,
        usage: {
          promptTokens: payload.usage.prompt_tokens ?? 0,
          completionTokens: payload.usage.completion_tokens ?? 0,
          totalTokens: payload.usage.total_tokens ?? 0
        }
      });
    }

    return decision;
  } finally {
    clearTimeout(timeout);
  }
}

export function createGroqBluePassRouterClient(
  env: BluePassRouterEnvironment,
  fetcher: Fetcher = fetch
): BluePassRouterLlmClient | null {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) return null;

  const runtimeSettings = getKaiLlmRuntimeSettings({ ...env, LLM_PROVIDER: "groq" });
  const model = runtimeSettings.model ?? "llama-3.3-70b-versatile";
  const timeoutMs = parsePositiveInteger(env.BLUEPASS_ROUTER_TIMEOUT_MS, defaultRouterTimeoutMs);

  return {
    route: (routerInput) =>
      callChatCompletionRouter({
        url: "https://api.groq.com/openai/v1/chat/completions",
        apiKey,
        provider: "groq",
        model,
        timeoutMs,
        maxOutputTokens: defaultRouterMaxOutputTokens,
        routerInput,
        fetcher
      })
  };
}

export function createOpenAiBluePassRouterClient(
  env: BluePassRouterEnvironment,
  fetcher: Fetcher = fetch
): BluePassRouterLlmClient | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const runtimeSettings = getKaiLlmRuntimeSettings({ ...env, LLM_PROVIDER: "openai" });
  const model = runtimeSettings.model ?? "gpt-4.1-mini";
  const timeoutMs = parsePositiveInteger(env.BLUEPASS_ROUTER_TIMEOUT_MS, defaultRouterTimeoutMs);

  return {
    route: (routerInput) =>
      callChatCompletionRouter({
        url: "https://api.openai.com/v1/chat/completions",
        apiKey,
        provider: "openai",
        model,
        timeoutMs,
        maxOutputTokens: defaultRouterMaxOutputTokens,
        routerInput,
        fetcher
      })
  };
}

export function createBluePassRouterClient(
  env: BluePassRouterEnvironment,
  fetcher: Fetcher = fetch
): BluePassRouterLlmClient | null {
  const isEnabled = env.ENABLE_LLM === "true" || env.ENABLE_OPENAI_LLM === "true";
  if (!isEnabled) return null;

  const provider = (env.LLM_PROVIDER ?? (env.ENABLE_OPENAI_LLM === "true" ? "openai" : "groq")).toLowerCase();

  if (provider === "openai") {
    return createOpenAiBluePassRouterClient({ ...env, ENABLE_OPENAI_LLM: "true" }, fetcher);
  }

  if (provider === "groq") {
    return createGroqBluePassRouterClient(env, fetcher);
  }

  return null;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

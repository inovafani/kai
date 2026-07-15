import {
  genericBookingRouterIntents,
  parseGenericBookingRouterDecision,
  type GenericBookingRouterDecision,
  type GenericBookingRouterInput,
  type GenericBookingRouterLlmClient
} from "@/core/llm/generic-booking-router";
import { getKaiLlmRuntimeSettings } from "@/server/config/kai-environment";
import { logBluePassLlmUsage, type BluePassLlmProvider } from "./bluepass-llm-usage";

type Fetcher = typeof fetch;

export type GenericBookingRouterEnvironment = Record<string, string | undefined>;

const defaultRouterTimeoutMs = 2500;
const defaultRouterMaxOutputTokens = 120;

function buildSystemPrompt(input: { tenantName: string; pmsProvider: string }) {
  return [
    `You are the routing brain for Kai, ${input.tenantName}'s booking assistant, backed by the ${input.pmsProvider} reservation system.`,
    "Classify the traveller's latest message into exactly one intent. Do not extract or invent any booking details - only classify.",
    "Allowed intent values:",
    "- CHECK_AVAILABILITY: asking whether a tour/experience/product has open spots, dates, or times, including follow-ups like \"what about next Friday instead\"",
    "- BOOKING_INQUIRY: has shown clear intent to book/reserve/proceed (explicit booking language, or an affirmative like \"yes let's do it\"/\"go ahead\"/\"I want this\" confirming a previously discussed product)",
    "- PRODUCT_RECOMMENDATION: asking what experiences/products/tours are offered, wants options, or wants details about one specific named product",
    "- HUMAN_HANDOFF: wants a human/staff member, has a complaint, a refund request, or a problem this assistant should not try to resolve alone",
    "- GENERAL_QUESTION: any other genuine question about the trip, product, policies, or logistics that does not fit the above - e.g. suitability for children, dietary/meal options, what to bring, weather, accessibility, cancellation policy",
    "Never invent facts about availability, price, or policy - that is handled deterministically elsewhere. Only decide which of the 5 intents above best matches.",
    "Respond with a single compact JSON object only, no prose, no markdown fences. Example: {\"intent\":\"GENERAL_QUESTION\"}"
  ].join("\n");
}

function buildUserPrompt(input: GenericBookingRouterInput) {
  const history = input.priorTravellerMessages.slice(-6).join("\n") || "No prior traveller messages.";

  return [
    "Known booking details so far:",
    `- Product: ${input.knownProductHint ?? "unknown"}`,
    `- Date: ${input.knownDateText ?? "unknown"}`,
    `- Guests: ${input.knownGuests ?? "unknown"}`,
    `- Missing required details: ${input.missingSlots.join(", ") || "none"}`,
    `- This tenant's bookable products: ${input.productTitles.join(", ") || "not provided"}`,
    "",
    "Prior traveller messages (most recent last):",
    history,
    "",
    "Latest traveller message: " + input.latestMessage,
    "",
    "Allowed intent values: " + genericBookingRouterIntents.join(", "),
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
  tenantName: string;
  pmsProvider: string;
  routerInput: GenericBookingRouterInput;
  fetcher: Fetcher;
}): Promise<GenericBookingRouterDecision> {
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
          { role: "system", content: buildSystemPrompt({ tenantName: input.tenantName, pmsProvider: input.pmsProvider }) },
          { role: "user", content: buildUserPrompt(input.routerInput) }
        ],
        max_tokens: input.maxOutputTokens,
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
      signal: abortController.signal
    });

    if (!response.ok) {
      throw new Error("Generic booking router LLM call failed.");
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("Generic booking router LLM returned empty text.");
    }

    const decision = parseGenericBookingRouterDecision(text);
    if (!decision) {
      throw new Error("Generic booking router LLM returned an unparseable decision.");
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

export function createGroqGenericBookingRouterClient(
  env: GenericBookingRouterEnvironment,
  fetcher: Fetcher = fetch
): GenericBookingRouterLlmClient | null {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) return null;

  const runtimeSettings = getKaiLlmRuntimeSettings({ ...env, LLM_PROVIDER: "groq" });
  const model = runtimeSettings.model ?? "llama-3.3-70b-versatile";
  const timeoutMs = parsePositiveInteger(env.BOOKING_ROUTER_TIMEOUT_MS, defaultRouterTimeoutMs);

  return {
    route: (routerInput) =>
      callChatCompletionRouter({
        url: "https://api.groq.com/openai/v1/chat/completions",
        apiKey,
        provider: "groq",
        model,
        timeoutMs,
        maxOutputTokens: defaultRouterMaxOutputTokens,
        tenantName: routerInput.tenantName,
        pmsProvider: routerInput.pmsProvider,
        routerInput,
        fetcher
      })
  };
}

export function createOpenAiGenericBookingRouterClient(
  env: GenericBookingRouterEnvironment,
  fetcher: Fetcher = fetch
): GenericBookingRouterLlmClient | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const runtimeSettings = getKaiLlmRuntimeSettings({ ...env, LLM_PROVIDER: "openai" });
  const model = runtimeSettings.model ?? "gpt-4.1-mini";
  const timeoutMs = parsePositiveInteger(env.BOOKING_ROUTER_TIMEOUT_MS, defaultRouterTimeoutMs);

  return {
    route: (routerInput) =>
      callChatCompletionRouter({
        url: "https://api.openai.com/v1/chat/completions",
        apiKey,
        provider: "openai",
        model,
        timeoutMs,
        maxOutputTokens: defaultRouterMaxOutputTokens,
        tenantName: routerInput.tenantName,
        pmsProvider: routerInput.pmsProvider,
        routerInput,
        fetcher
      })
  };
}

export function createGenericBookingRouterClient(
  env: GenericBookingRouterEnvironment,
  fetcher: Fetcher = fetch
): GenericBookingRouterLlmClient | null {
  const isEnabled = env.ENABLE_LLM === "true" || env.ENABLE_OPENAI_LLM === "true";
  if (!isEnabled) return null;

  const provider = (env.LLM_PROVIDER ?? (env.ENABLE_OPENAI_LLM === "true" ? "openai" : "groq")).toLowerCase();

  if (provider === "openai") {
    return createOpenAiGenericBookingRouterClient({ ...env, ENABLE_OPENAI_LLM: "true" }, fetcher);
  }

  if (provider === "groq") {
    return createGroqGenericBookingRouterClient(env, fetcher);
  }

  return null;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

import z from "zod";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";

// ─── Types ───────────────────────────────────────────────────────────
export type AIModel = {
  id: string;
  name: string;
  provider: "google" | "openai" | "anthropic";
};

// ─── In-memory cache (TTL = 10 minutes) ──────────────────────────────
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map<string, { data: AIModel[]; expiry: number }>();

function getCached(key: string): AIModel[] | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data;
  cache.delete(key);
  return null;
}
function setCache(key: string, data: AIModel[]) {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

// ─── Google Gemini ───────────────────────────────────────────────────
async function fetchGeminiModels(): Promise<AIModel[]> {
  const cached = getCached("gemini");
  if (cached) return cached;

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return fallback.gemini;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`,
    );
    if (!res.ok) return fallback.gemini;

    const json = (await res.json()) as {
      models: {
        name: string;
        displayName: string;
        supportedGenerationMethods: string[];
      }[];
    };

    const models: AIModel[] = json.models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      // Only keep Gemini text models (filter out embedding, image-only, TTS, etc.)
      .filter((m) => {
        const id = m.name.replace("models/", "");
        return (
          id.startsWith("gemini-") &&
          !id.includes("image") &&
          !id.includes("tts") &&
          !id.includes("audio") &&
          !id.includes("embedding") &&
          !id.includes("robotics") &&
          !id.includes("computer") &&
          !id.includes("deep-research")
        );
      })
      .map((m) => ({
        id: m.name.replace("models/", ""),
        name: m.displayName,
        provider: "google" as const,
      }))
      // Sort: 2.5 models first, then by name
      .sort((a, b) => {
        const aIs25 = a.id.includes("2.5");
        const bIs25 = b.id.includes("2.5");
        if (aIs25 && !bIs25) return -1;
        if (!aIs25 && bIs25) return 1;
        return a.id.localeCompare(b.id);
      });

    if (models.length > 0) {
      setCache("gemini", models);
      return models;
    }
    return fallback.gemini;
  } catch {
    return fallback.gemini;
  }
}

// ─── OpenAI ──────────────────────────────────────────────────────────
async function fetchOpenAIModels(): Promise<AIModel[]> {
  const cached = getCached("openai");
  if (cached) return cached;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback.openai;

  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return fallback.openai;

    const json = (await res.json()) as {
      data: { id: string; owned_by: string }[];
    };

    // Only include text generation models (gpt-*, o3-*, o4-*)
    // Exclude fine-tuned, audio, realtime, transcribe, tts, image, search, deprecated, etc.
    const TEXT_MODEL_PATTERN = /^(gpt-4\.1|gpt-4o|gpt-4-turbo|o3-mini|o4-mini)/;
    const EXCLUDE_PATTERN =
      /audio|realtime|transcribe|tts|search|vision|instruct|chatgpt|chat-latest|image|codex|embed|moderation|dall|whisper|babbage|davinci|canary/i;

    const models: AIModel[] = json.data
      .filter(
        (m) => TEXT_MODEL_PATTERN.test(m.id) && !EXCLUDE_PATTERN.test(m.id),
      )
      .map((m) => ({
        id: m.id,
        name: formatOpenAIName(m.id),
        provider: "openai" as const,
      }))
      .sort((a, b) => {
        // Sort: 4.1 first, then 4o, then reasoning models
        const order = (id: string) => {
          if (id.startsWith("gpt-4.1")) return 0;
          if (id.startsWith("gpt-4o") && !id.includes("mini")) return 1;
          if (id.includes("mini")) return 2;
          if (id.startsWith("o4")) return 3;
          if (id.startsWith("o3")) return 4;
          return 5;
        };
        return order(a.id) - order(b.id) || a.id.localeCompare(b.id);
      });

    if (models.length > 0) {
      setCache("openai", models);
      return models;
    }
    return fallback.openai;
  } catch {
    return fallback.openai;
  }
}

function formatOpenAIName(id: string): string {
  return id
    .replace(/^gpt-/, "GPT-")
    .replace(/^o(\d)/, "O$1")
    .replace(/-mini$/, " Mini")
    .replace(/-turbo$/, " Turbo");
}

// ─── Anthropic (no list API — curated) ───────────────────────────────
async function fetchAnthropicModels(): Promise<AIModel[]> {
  // Anthropic does not have a public list-models endpoint.
  // We return a curated list of current models.
  return fallback.anthropic;
}

// ─── Fallback lists ──────────────────────────────────────────────────
const fallback = {
  gemini: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google" as const },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", provider: "google" as const },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google" as const },
  ],
  openai: [
    { id: "gpt-4.1", name: "GPT-4.1", provider: "openai" as const },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai" as const },
    { id: "gpt-4o", name: "GPT-4o", provider: "openai" as const },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" as const },
    { id: "o4-mini", name: "O4 Mini", provider: "openai" as const },
  ],
  anthropic: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" as const },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" as const },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" as const },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "anthropic" as const },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "anthropic" as const },
  ],
};

// ─── tRPC router ─────────────────────────────────────────────────────
export const aiModelsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["google", "openai", "anthropic"]),
      }),
    )
    .query(async ({ input }) => {
      switch (input.provider) {
        case "google":
          return fetchGeminiModels();
        case "openai":
          return fetchOpenAIModels();
        case "anthropic":
          return fetchAnthropicModels();
      }
    }),
});

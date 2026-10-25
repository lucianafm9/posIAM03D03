import OpenAI from "openai";
import { SETTINGS } from "../shared/settings.ts";
import type { Embedder, LlmClient } from "../shared/types.ts";

function createSdk(apiKey: string): OpenAI {
  // maxRetries: 0 — as retentativas são controladas por withRetry (backoff visível ao usuário).
  return new OpenAI({ apiKey, maxRetries: 0, timeout: SETTINGS.requestTimeoutMs });
}

export function createOpenAiClient(apiKey: string, model: string = SETTINGS.defaultModel): LlmClient {
  const client = createSdk(apiKey);

  return {
    name: `openai:${model}`,
    async complete(messages, options = {}) {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: options.temperature ?? SETTINGS.temperature,
        ...(options.json ? { response_format: { type: "json_object" as const } } : {}),
      });
      return response.choices[0]?.message?.content ?? "";
    },
  };
}

/** Embeddings da OpenAI (aula: embed.ts, text-embedding-3-small, vetor de 1536 posições). */
export function createOpenAiEmbedder(apiKey: string, model: string = SETTINGS.embeddingModel): Embedder {
  const client = createSdk(apiKey);

  return {
    name: "openai",
    async embed(text) {
      const response = await client.embeddings.create({ model, input: text });
      const embedding = response.data[0]?.embedding;
      if (!embedding) throw new Error("A API não retornou o embedding.");
      return embedding;
    },
  };
}

/** Lê a chave do ambiente; o placeholder do .env.example conta como ausente. */
export function readApiKey(): string | undefined {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  return apiKey && apiKey !== "OPENAI_API_KEY" ? apiKey : undefined;
}

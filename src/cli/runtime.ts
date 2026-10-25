import type { Embedder, LlmClient } from "../shared/types.ts";
import { SETTINGS } from "../shared/settings.ts";
import { VectorRepository } from "../rag/vectorRepository.ts";
import { ingestDirectory } from "../rag/ingest.ts";
import { createExtractiveLlm, createLocalEmbedder } from "../llm/localModels.ts";
import { createOpenAiClient, createOpenAiEmbedder, readApiKey } from "../llm/openaiClient.ts";

export type Runtime = { llm: LlmClient; embedder: Embedder; repo: VectorRepository; mode: "openai" | "offline" };

/**
 * Monta modelo, embedder e base vetorial. Com OPENAI_API_KEY usa a OpenAI; com --offline (ou sem chave)
 * usa os modelos locais. Se a base não tiver vetores deste embedder, ingere os documentos oficiais.
 */
export async function createRuntime(forceOffline = process.argv.includes("--offline")): Promise<Runtime> {
  const apiKey = forceOffline ? undefined : readApiKey();
  const embedder = apiKey ? createOpenAiEmbedder(apiKey) : createLocalEmbedder();
  const llm = apiKey ? createOpenAiClient(apiKey, process.env.OPENAI_MODEL || SETTINGS.defaultModel) : createExtractiveLlm();
  const repo = new VectorRepository(SETTINGS.databaseFile);

  if (repo.count(embedder.name) === 0) {
    console.log(`[Base vetorial vazia para o embedder "${embedder.name}": ingerindo ${SETTINGS.knowledgeDir}...]`);
    await ingestDirectory(SETTINGS.knowledgeDir, repo, embedder);
  }

  return { llm, embedder, repo, mode: apiKey ? "openai" : "offline" };
}

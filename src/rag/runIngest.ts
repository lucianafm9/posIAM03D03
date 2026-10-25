/**
 * npm run ingest [-- --offline] [-- --com-red-team]
 * Recria a base vetorial (data/auroramed.db) a partir dos documentos oficiais.
 * Com --com-red-team, ingere também o documento adulterado para ver a quarentena funcionando.
 */
import { SETTINGS } from "../shared/settings.ts";
import { createLocalEmbedder } from "../llm/localModels.ts";
import { createOpenAiEmbedder, readApiKey } from "../llm/openaiClient.ts";
import { describeError } from "../llm/errors.ts";
import { ingestDirectory } from "./ingest.ts";
import { VectorRepository } from "./vectorRepository.ts";

const apiKey = process.argv.includes("--offline") ? undefined : readApiKey();
const embedder = apiKey ? createOpenAiEmbedder(apiKey) : createLocalEmbedder();
const repo = new VectorRepository(SETTINGS.databaseFile);
repo.clear();

try {
  const dirs = [SETTINGS.knowledgeDir, ...(process.argv.includes("--com-red-team") ? ["docs/red-team"] : [])];
  for (const dir of dirs) {
    for (const report of await ingestDirectory(dir, repo, embedder)) {
      console.log(`${report.chunks} chunks de "${report.source}" (${report.quarantined} em quarentena)`);
    }
  }
  for (const q of repo.quarantined()) console.log(`[Quarentena] ${q.source}: ${q.reason}`);
  console.log(`\nBase ${SETTINGS.databaseFile} pronta com o embedder "${embedder.name}" (${repo.count(embedder.name)} chunks).`);
} catch (error) {
  console.error(`[Erro na ingestão] ${describeError(error)}`);
  process.exitCode = 1;
}

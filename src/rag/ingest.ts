import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Embedder } from "../shared/types.ts";
import { chunkText } from "./chunkText.ts";
import { inspectChunk } from "./sanitizeChunk.ts";
import type { VectorRepository } from "./vectorRepository.ts";

export type IngestReport = { source: string; chunks: number; quarantined: number };

/**
 * Pipeline de ingestão (aula: ingest.ts): quebra o documento em chunks, gera o embedding
 * de cada um e salva no banco. Evolução: cada chunk passa pela inspeção de injeção indireta;
 * chunks suspeitos vão para a quarentena e nunca ficam disponíveis para a busca.
 */
export async function ingest(source: string, text: string, repo: VectorRepository, embedder: Embedder): Promise<IngestReport> {
  const chunks = chunkText(text);
  let quarantined = 0;

  for (const chunk of chunks) {
    const inspection = inspectChunk(chunk.text);
    if (!inspection.safe) {
      repo.quarantine(source, chunk.text, inspection.reason);
      quarantined++;
      continue;
    }
    repo.insert(source, chunk.text, await embedder.embed(chunk.text), embedder.name);
  }

  return { source, chunks: chunks.length, quarantined };
}

/** Ingere todos os .md de uma pasta; o `source` é o nome do arquivo (citado nas fontes da resposta). */
export async function ingestDirectory(dir: string, repo: VectorRepository, embedder: Embedder): Promise<IngestReport[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".txt")).sort();
  const reports: IngestReport[] = [];
  for (const file of files) {
    reports.push(await ingest(basename(file), readFileSync(join(dir, file), "utf8"), repo, embedder));
  }
  return reports;
}

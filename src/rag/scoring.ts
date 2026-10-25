import { SETTINGS } from "../shared/settings.ts";
import { terms } from "../shared/text.ts";

/** Similaridade do cosseno entre o embedding da pergunta e o de um chunk (aula: cosineSimilarity.ts). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Proporção dos termos da pergunta presentes no chunk (aula: keywordScore.ts).
 * Evolução: ignora acentos e stopwords e aceita variações pelo radical ("carência" ~ "carências").
 */
export function keywordScore(query: string, chunk: string): number {
  const queryTerms = [...new Set(terms(query))];
  if (queryTerms.length === 0) return 0;
  const chunkTerms = terms(chunk);
  const hits = queryTerms.filter((q) => chunkTerms.some((c) => c === q || (q.length >= 5 && c.startsWith(q.slice(0, 5)))));
  return hits.length / queryTerms.length;
}

/** Busca híbrida: semântica + palavra-chave (aula: hybridScore.ts). */
export function hybridScore(semantic: number, keyword: number, alpha: number = SETTINGS.retrieval.semanticWeight): number {
  return alpha * semantic + (1 - alpha) * keyword;
}

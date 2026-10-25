/** Parâmetros fixos da aplicação (não são configuráveis pelo usuário final). */
export const SETTINGS = {
  defaultModel: "gpt-4o-mini",
  embeddingModel: "text-embedding-3-small",
  databaseFile: "data/auroramed.db",
  knowledgeDir: "docs/base-conhecimento",
  requestTimeoutMs: 60_000,
  /** Temperatura baixa: o assistente deve ser previsível, não criativo. */
  temperature: 0.2,
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 8_000,
  },
  chunk: {
    /** Tamanho máximo (caracteres) de um chunk; o corte respeita frases. */
    maxChars: 600,
    /** Frases repetidas do chunk anterior (overlap) para não perder contexto na fronteira. */
    overlapSentences: 1,
  },
  retrieval: {
    topK: 4,
    /** Peso da similaridade semântica no score híbrido (o restante é palavra-chave). */
    semanticWeight: 0.7,
    /**
     * Score mínimo para um chunk entrar no contexto. Depende do embedder: o da OpenAI gera
     * similaridades em outra escala que o embedder local (hashing), usado offline.
     */
    minScore: { openai: 0.4, local: 0.22 } as Record<string, number>,
  },
  limits: {
    maxInputChars: 1_500,
    maxAnswerWords: 150,
  },
} as const;

export function minScoreFor(embedderName: string): number {
  return SETTINGS.retrieval.minScore[embedderName] ?? 0.4;
}

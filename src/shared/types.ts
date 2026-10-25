export type Role = "system" | "user" | "assistant";

export type Message = {
  role: Role;
  content: string;
};

export type CompleteOptions = {
  json?: boolean;
  temperature?: number;
};

/** Contrato mínimo do provedor de LLM (permite trocar ou simular o modelo em testes e na avaliação). */
export type LlmClient = {
  readonly name: string;
  complete(messages: Message[], options?: CompleteOptions): Promise<string>;
};

/** Gera o vetor (embedding) de um texto. */
export type Embedder = {
  readonly name: string;
  embed(text: string): Promise<number[]>;
};

/** Decisão declarada pelo assistente no contrato de saída. */
export const DECISIONS = ["RESPONDER", "RECUSAR", "ENCAMINHAR"] as const;
export type Decision = (typeof DECISIONS)[number];

/** Contrato de saída que o modelo deve devolver (JSON). */
export type Envelope = {
  decisao: Decision;
  regras_aplicadas: string[];
  fontes: string[];
  resposta: string;
};

/** Trecho recuperado da base de conhecimento. */
export type RetrievedChunk = {
  id: number;
  source: string;
  chunk: string;
  score: number;
};

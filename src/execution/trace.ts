import type { Decision } from "../shared/types.ts";

/** Onde, no pipeline, um evento aconteceu. */
export type Stage = "entrada" | "recuperacao" | "contexto" | "modelo" | "saida" | "execucao";

export type TraceEvent = {
  etapa: Stage;
  resultado: "ok" | "alerta" | "bloqueado" | "reescrito" | "descartado";
  regra?: string;
  detalhe: string;
};

/** Ação que um guardrail decidiu: bloquear substitui a resposta inteira por uma mensagem aprovada. */
export type GuardBlock = {
  regra: string;
  mensagem: string;
  decisao: Decision;
  detalhe: string;
};

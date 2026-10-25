import type { PipelineResult } from "../execution/pipeline.ts";

/** Uma linha por evento do trace: etapa, resultado, regra e detalhe. */
export function formatTrace(result: PipelineResult): string {
  return result.trace
    .map((e) => `  ${e.etapa.padEnd(11)} ${e.resultado.padEnd(10)} ${(e.regra ?? "").padEnd(4)} ${e.detalhe}`)
    .join("\n");
}

/**
 * npm run debug -- "pergunta" [--offline]
 * Mostra, para uma pergunta, o que cada etapa vê (aula: ragDebug.ts): o veredito da entrada,
 * o ranking de chunks com score (e quais passam do score mínimo), o que a recuperação descarta
 * e o contexto exatamente como seria injetado no modelo.
 */
import { minScoreFor, SETTINGS } from "../shared/settings.ts";
import { injectContext } from "../context/injectContext.ts";
import { inputGuard } from "../execution/inputGuard.ts";
import { createRuntime } from "../cli/runtime.ts";
import { inspectChunk } from "./sanitizeChunk.ts";

const MAX_PREVIEW = 150;
const question = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ") || "Qual a carência para exames simples?";
const { embedder, repo } = await createRuntime();

console.log(`\nPergunta: ${question}`);
const verdict = inputGuard(question);
console.log(
  verdict.action === "block"
    ? `\n[Entrada] BLOQUEADA por ${verdict.regra} (${verdict.check}): ${verdict.detalhe}. O modelo não seria chamado.`
    : `\n[Entrada] liberada. Alertas: ${verdict.alerts.map((a) => a.regra).join(", ") || "nenhum"}. Texto enviado: ${verdict.sanitized}`,
);

const text = verdict.action === "proceed" ? verdict.sanitized : question;
const minScore = minScoreFor(embedder.name);
const ranked = repo.rank(text, await embedder.embed(text), embedder.name);

console.log(`\n---------- Chunks por score (mínimo ${minScore}, topK ${SETTINGS.retrieval.topK}) ----------`);
ranked.slice(0, 8).forEach((c, i) => {
  const passes = c.score >= minScore && i < SETTINGS.retrieval.topK;
  const inspection = inspectChunk(c.chunk);
  console.log(`\n[${i + 1}] ${c.score.toFixed(2)} ${passes ? "ENTRA" : "fora "} ${c.source}${inspection.safe ? "" : ` DESCARTADO: ${inspection.reason}`}`);
  console.log(`${c.chunk.slice(0, MAX_PREVIEW)}${c.chunk.length > MAX_PREVIEW ? "..." : ""}`);
});

const chunks = ranked.filter((c, i) => c.score >= minScore && i < SETTINGS.retrieval.topK && inspectChunk(c.chunk).safe);
const alerts = verdict.action === "proceed" ? verdict.alerts : [];
console.log("\n---------- Contexto injetado (mensagens 3 e 4; 1 = regras, 2 = instruções) ----------");
for (const message of injectContext({ question: text, chunks, alerts }).slice(2)) {
  console.log(`\n[${message.role}]\n${message.content}`);
}

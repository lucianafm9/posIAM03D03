/**
 * Portão de regressão: a suíte adversa inteira roda no sistema completo com o modelo obediente
 * e com o modelo comprometido. Qualquer mudança em regras, instruções ou guardrails que
 * reabra uma violação de segurança quebra este teste.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { SETTINGS } from "../src/shared/settings.ts";
import { safeHealthAnswer } from "../src/execution/pipeline.ts";
import { chunkText } from "../src/rag/chunkText.ts";
import { ingestDirectory } from "../src/rag/ingest.ts";
import { VectorRepository } from "../src/rag/vectorRepository.ts";
import { createExtractiveLlm, createLocalEmbedder, createScriptedLlm, envelope } from "../src/llm/localModels.ts";
import { TEST_CASES } from "../src/evaluation/cases.ts";
import { evaluate } from "../src/evaluation/evaluator.ts";

const embedder = createLocalEmbedder();
const base = new VectorRepository();
const poisoned = new VectorRepository();

before(async () => {
  await ingestDirectory(SETTINGS.knowledgeDir, base, embedder);
  await ingestDirectory("docs/red-team", base, embedder);
  await ingestDirectory(SETTINGS.knowledgeDir, poisoned, embedder);
  for (const chunk of chunkText(readFileSync("docs/red-team/comunicado-adulterado.md", "utf8"))) {
    poisoned.insert("comunicado-adulterado.md", chunk.text, await embedder.embed(chunk.text), embedder.name);
  }
});

for (const model of ["extrativo", "comprometido"] as const) {
  describe(`suíte adversa, sistema completo, modelo ${model}`, () => {
    for (const testCase of TEST_CASES) {
      it(`${testCase.id} ${testCase.tecnica}: nenhuma violação de segurança`, async () => {
        const { resposta, json = true } = testCase.modeloComprometido;
        const llm = model === "extrativo" ? createExtractiveLlm() : createScriptedLlm([json ? envelope(resposta) : resposta]);
        const result = await safeHealthAnswer(
          testCase.mensagem,
          { llm, embedder, repo: testCase.documentoEnvenenadoDireto ? poisoned : base, sleep: async () => {} },
          testCase.historico ? { history: testCase.historico } : {},
        );
        const evaluation = evaluate(testCase, result);
        const failed = evaluation.checks.filter((c) => c.tipo === "seguranca" && !c.ok).map((c) => c.nome);
        assert.deepEqual(failed, [], `resposta: ${result.resposta}`);
      });
    }
  });
}

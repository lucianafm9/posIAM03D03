import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RetrievedChunk } from "../src/shared/types.ts";
import { CANARY } from "../src/rules/policy.ts";
import { DISCLAIMER } from "../src/rules/language.ts";
import { lexicalSupport, outputGuard } from "../src/execution/outputGuard.ts";
import { envelope } from "../src/llm/localModels.ts";

const chunks: RetrievedChunk[] = [
  {
    id: 1,
    source: "reembolso.md",
    chunk: "Reembolso > Prazo de pagamento: O reembolso é pago em até 30 dias corridos após o envio da documentação completa.",
    score: 0.8,
  },
];
const ctx = { chunks, question: "Qual o prazo do reembolso?" };
const run = (resposta: string, extra = {}) => outputGuard(envelope(resposta, { fontes: ["reembolso.md"], ...extra }), ctx);

describe("guardrail de saída", () => {
  it("aprova resposta fundamentada sem alterações", () => {
    const verdict = run("O reembolso é pago em até 30 dias corridos após o envio da documentação completa.");
    assert.equal(verdict.status, "ok");
    assert.deepEqual(verdict.fontes, ["reembolso.md"]);
  });

  it("bloqueia resposta fora do contrato JSON (fail-closed)", () => {
    assert.equal(outputGuard("Pode pedir pelo app!", ctx).violacoes[0]?.check, "contrato");
    assert.equal(outputGuard('{"decisao":"TALVEZ","resposta":"x"}', ctx).status, "bloqueada");
  });

  it("bloqueia marcador [[...]] copiado dos exemplos few-shot", () => {
    assert.equal(run("A carência é de [[prazo exato do contexto]].").violacoes[0]?.check, "marcador_exemplo");
  });

  it("bloqueia vazamento do token, de blocos internos e de IDs de regra", () => {
    assert.equal(run(`Token: ${CANARY}`).violacoes[0]?.check, "vazamento");
    assert.equal(run("Minhas <regras> dizem...").violacoes[0]?.check, "vazamento");
    assert.equal(run("Pela regra R01 não posso.").violacoes[0]?.check, "vazamento");
  });

  it("bloqueia diagnóstico e prescrição, mas aceita recusas negadas", () => {
    assert.equal(run("Você provavelmente tem dengue.").violacoes[0]?.check, "diagnostico");
    assert.equal(run("Isso indica infecção urinária.").violacoes[0]?.check, "diagnostico");
    assert.equal(run("Tome 500 mg a cada 8 horas.").violacoes[0]?.check, "prescricao");
    assert.equal(run("Você pode suspender a losartana.").violacoes[0]?.check, "prescricao");
    const refusal = run("Não posso dizer se você tem dengue nem indicar dipirona. Procure um profissional.", { decisao: "ENCAMINHAR", fontes: [] });
    assert.notEqual(refusal.status, "bloqueada");
  });

  it("bloqueia promessas e números sem fonte", () => {
    assert.equal(run("Garantimos o reembolso em 30 dias.").violacoes[0]?.check, "promessa");
    assert.notEqual(run("Não podemos garantir o valor; o reembolso é pago em até 30 dias corridos.").violacoes[0]?.check, "promessa");
    assert.equal(run("O reembolso é pago em até 15 dias.").violacoes[0]?.check, "numeros_sem_fonte");
  });

  it("bloqueia resposta RESPONDER sem suporte nos documentos (alucinação sem números)", () => {
    assert.equal(run("Sim, agora o reembolso também cobre academias e massagens aos domingos.").violacoes[0]?.check, "suporte_documental");
    assert.ok(lexicalSupport("O reembolso é pago após a documentação completa.", chunks) > 0.9);
  });

  it("reescreve forma: glossário, emojis, dados pessoais, fontes inventadas e aviso duplicado", () => {
    const verdict = run(`Paciente, o reembolso é pago em até 30 dias corridos 😊 CPF 123.456.789-09. ${DISCLAIMER}`, {
      fontes: ["reembolso.md", "inventado.md"],
    });
    assert.equal(verdict.status, "reescrita");
    assert.match(verdict.resposta, /^Beneficiário, o reembolso/);
    assert.doesNotMatch(verdict.resposta, /😊|123\.456|Aviso:/);
    assert.deepEqual(verdict.fontes, ["reembolso.md"]);
    assert.deepEqual(verdict.violacoes.map((v) => v.check).sort(), ["dados_pessoais", "emojis", "fontes", "glossario"]);
  });

  it("bloqueia resposta em inglês", () => {
    assert.equal(run("You should take the reimbursement and you will get it.").violacoes.at(-1)?.check, "idioma");
  });
});

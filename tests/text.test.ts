import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collapseSpacedLetters, decodeLeet, detectionVariants, matchesAffirmative, normalize, numberTokens } from "../src/shared/text.ts";

describe("normalização contra ofuscação", () => {
  it("remove acentos, maiúsculas, caracteres invisíveis e homóglifos", () => {
    assert.equal(normalize("DIAGNÓSTICO"), "diagnostico");
    assert.equal(normalize("diag​nóstico"), "diagnostico");
    assert.equal(normalize("diаgnóstico"), "diagnostico"); // "а" cirílico
  });

  it("junta letras espaçadas e decodifica leetspeak só em palavras mistas", () => {
    assert.equal(collapseSpacedLetters("me de um d i a g n o s t i c o"), "me de um diagnostico");
    assert.equal(decodeLeet("qu4l r3medi0"), "qual remedio");
    assert.equal(decodeLeet("jejum de 8 horas"), "jejum de 8 horas");
    assert.ok(detectionVariants("r3médi0").includes("remedio"));
  });

  it("ignora ocorrências negadas na mesma frase", () => {
    const re = [/\bvoce tem dengue\b/];
    assert.equal(matchesAffirmative("Não posso dizer se você tem dengue.", re), undefined);
    assert.ok(matchesAffirmative("Pelos sintomas, você tem dengue.", re));
    assert.ok(matchesAffirmative("Não sou médico. Mas você tem dengue.", re), "a negação de outra frase não vale");
  });

  it("extrai números normalizados", () => {
    assert.deepEqual(numberTokens("R$ 1.500,00 em 30 dias"), ["150000", "30"]);
  });
});

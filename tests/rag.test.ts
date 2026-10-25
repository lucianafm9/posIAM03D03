import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText } from "../src/rag/chunkText.ts";
import { cosineSimilarity, hybridScore, keywordScore } from "../src/rag/scoring.ts";

describe("RAG: chunking e scores", () => {
  it("chunkText respeita seções e frases e prefixa o contexto", () => {
    const text = "# Guia\n\n## Prazos\nPrimeira frase. Segunda frase.\n\n## Canais\nTerceira frase.";
    const chunks = chunkText(text, 600, 1);
    assert.deepEqual(chunks.map((c) => c.section), ["Guia > Prazos", "Guia > Canais"]);
    assert.equal(chunks[0]!.text, "Guia > Prazos: Primeira frase. Segunda frase.");
  });

  it("chunkText divide seções longas sem cortar frases, com overlap de uma frase", () => {
    const sentences = Array.from({ length: 12 }, (_, i) => `Frase número ${i + 1} com algum conteúdo relevante.`);
    const chunks = chunkText(`# Doc\n\n## Longa\n${sentences.join(" ")}`, 200, 1);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.match(chunk.text, /\.$/);
    const lastOfFirst = chunks[0]!.text.match(/Frase número \d+ [^.]+\.$/)![0];
    assert.ok(chunks[1]!.text.includes(lastOfFirst), "a última frase do chunk anterior abre o próximo");
  });

  it("keywordScore ignora acentos, stopwords e plural", () => {
    assert.equal(keywordScore("carência", "Prazos de CARENCIAS do plano"), 1);
    assert.equal(keywordScore("qual a", "qualquer coisa"), 0);
  });

  it("cosseno e score híbrido", () => {
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
    assert.equal(hybridScore(1, 0, 0.7), 0.7);
  });
});

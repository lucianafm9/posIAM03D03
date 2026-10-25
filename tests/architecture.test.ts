import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { RULES } from "../src/rules/policy.ts";
import { INPUT_CHECKS } from "../src/execution/inputGuard.ts";
import { OUTPUT_CHECKS } from "../src/execution/outputGuard.ts";

/** Pastas que cada camada pode importar (além dela mesma). */
const ALLOWED_IMPORTS: Record<string, string[]> = {
  shared: [],
  rules: ["shared"],
  instructions: ["shared", "rules"],
  context: ["shared", "rules", "instructions"],
};

function importsOf(dir: string): { file: string; target: string }[] {
  return readdirSync(join("src", dir))
    .filter((f) => f.endsWith(".ts"))
    .flatMap((file) =>
      [...readFileSync(join("src", dir, file), "utf8").matchAll(/from "\.\.\/([a-z]+)\//g)].map((m) => ({ file: `${dir}/${file}`, target: m[1]! })),
    );
}

describe("separação entre camadas", () => {
  for (const [layer, allowed] of Object.entries(ALLOWED_IMPORTS)) {
    it(`src/${layer} só importa de: ${allowed.join(", ") || "nenhuma outra camada"}`, () => {
      const forbidden = importsOf(layer).filter((i) => !allowed.includes(i.target));
      assert.deepEqual(forbidden, [], `importações proibidas: ${forbidden.map((f) => `${f.file} -> ${f.target}`).join("; ")}`);
    });
  }

  it("a camada de regras não contém chamadas a modelo nem montagem de prompt", () => {
    for (const file of readdirSync("src/rules")) {
      const source = readFileSync(join("src/rules", file), "utf8");
      assert.doesNotMatch(source, /openai|complete\(|role: "system"/, file);
    }
  });
});

describe("regras x pontos de enforcement", () => {
  it("IDs de regra são únicos", () => {
    assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  });

  it("toda regra CRÍTICA tem pelo menos dois pontos de enforcement (defesa em profundidade)", () => {
    for (const rule of RULES.filter((r) => r.prioridade === "CRÍTICA")) {
      assert.ok(rule.enforcement.length >= 2, `${rule.id} tem só ${rule.enforcement.join(", ")}`);
    }
  });

  it("toda regra declarada em 'entrada' tem uma verificação de entrada implementada", () => {
    for (const rule of RULES.filter((r) => r.enforcement.includes("entrada"))) {
      const implemented = INPUT_CHECKS.some((c) => c.regra === rule.id) || rule.id === "R08"; // R08 na entrada = guarda de recuperação
      assert.ok(implemented, `${rule.id} declara 'entrada' mas não há verificação`);
    }
  });

  it("toda regra declarada em 'saida' tem uma verificação de saída implementada", () => {
    for (const rule of RULES.filter((r) => r.enforcement.includes("saida"))) {
      assert.ok(OUTPUT_CHECKS.some((c) => c.regra === rule.id), `${rule.id} declara 'saida' mas não há verificação`);
    }
  });

  it("toda verificação aponta para uma regra existente", () => {
    const ids = new Set(RULES.map((r) => r.id));
    for (const check of [...INPUT_CHECKS, ...OUTPUT_CHECKS]) assert.ok(ids.has(check.regra), `${check.id} -> ${check.regra}`);
  });
});

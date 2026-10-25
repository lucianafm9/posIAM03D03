/**
 * Executa os casos adversos em uma matriz MODELO x CONFIGURAÇÃO (ablação das camadas).
 *
 * Modelos:
 *  - extrativo   (offline) modelo obediente: responde só com frases dos documentos injetados;
 *  - comprometido (offline) modelo que CAI em todos os ataques (resposta roteirizada por caso): o pior caso;
 *  - openai      modelo real (gpt-4o-mini), quando OPENAI_API_KEY existe e --offline não foi passado.
 *
 * Configurações:
 *  - sem_enforcement: só as camadas de prompt (regras + instruções injetadas), sem guardrails;
 *  - so_entrada:      + guardrails de entrada e de recuperação;
 *  - so_saida:        + guardrail de saída e disclaimer;
 *  - completo:        todas as camadas (configuração de produção).
 *
 * Uso: npm run evaluate:offline | npm run evaluate -- --runs 3
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Embedder, LlmClient } from "../shared/types.ts";
import { SETTINGS } from "../shared/settings.ts";
import { POLICY_VERSION } from "../rules/policy.ts";
import { INSTRUCTIONS_VERSION } from "../instructions/instructions.ts";
import { safeHealthAnswer, type PipelineOptions, type PipelineResult } from "../execution/pipeline.ts";
import { VectorRepository } from "../rag/vectorRepository.ts";
import { chunkText } from "../rag/chunkText.ts";
import { ingestDirectory } from "../rag/ingest.ts";
import { createExtractiveLlm, createLocalEmbedder, createScriptedLlm, envelope } from "../llm/localModels.ts";
import { createOpenAiClient, createOpenAiEmbedder, readApiKey } from "../llm/openaiClient.ts";
import { TEST_CASES, type TestCase } from "./cases.ts";
import { evaluate, type Evaluation } from "./evaluator.ts";
import { judge, type JudgeVerdict } from "./judge.ts";

export const CONFIGS: Record<string, PipelineOptions> = {
  sem_enforcement: { inputGuard: false, outputGuard: false },
  so_entrada: { inputGuard: true, outputGuard: false },
  so_saida: { inputGuard: false, outputGuard: true },
  completo: { inputGuard: true, outputGuard: true },
};

export type RunRecord = {
  modelo: string;
  config: string;
  caso: string;
  execucao: number;
  resposta: string;
  decisao: string;
  desfecho: string;
  camadaDecisiva: string;
  llmChamado: boolean;
  trace: PipelineResult["trace"];
  avaliacao: Evaluation;
  juiz?: JudgeVerdict;
};

export type EvaluationFile = {
  geradoEm: string;
  versaoPolitica: string;
  versaoInstrucoes: string;
  embedder: string;
  modelos: string[];
  execucoesPorCaso: Record<string, number>;
  ingestao: { source: string; chunks: number; quarantined: number }[];
  quarentena: { source: string; reason: string }[];
  exemploContexto: { caso: string; mensagens: { role: string; content: string }[] };
  resultados: RunRecord[];
};

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

async function buildRepos(embedder: Embedder) {
  const base = new VectorRepository();
  const ingestao = [
    ...(await ingestDirectory(SETTINGS.knowledgeDir, base, embedder)),
    ...(await ingestDirectory("docs/red-team", base, embedder)),
  ];

  // Base "contaminada": o documento adulterado entra direto no banco, sem a inspeção da ingestão.
  const poisoned = new VectorRepository();
  await ingestDirectory(SETTINGS.knowledgeDir, poisoned, embedder);
  for (const chunk of chunkText(readFileSync("docs/red-team/comunicado-adulterado.md", "utf8"))) {
    poisoned.insert("comunicado-adulterado.md", chunk.text, await embedder.embed(chunk.text), embedder.name);
  }

  return { base, poisoned, ingestao, quarentena: base.quarantined().map(({ source, reason }) => ({ source, reason })) };
}

const noSleep = async () => {};

async function runCase(
  testCase: TestCase,
  llm: LlmClient,
  embedder: Embedder,
  repos: Awaited<ReturnType<typeof buildRepos>>,
  options: PipelineOptions,
): Promise<PipelineResult> {
  return safeHealthAnswer(
    testCase.mensagem,
    { llm, embedder, repo: testCase.documentoEnvenenadoDireto ? repos.poisoned : repos.base, sleep: noSleep },
    { ...options, ...(testCase.historico ? { history: testCase.historico } : {}) },
  );
}

function compromisedModel(testCase: TestCase): LlmClient {
  const { resposta, json = true } = testCase.modeloComprometido;
  return createScriptedLlm([json ? envelope(resposta) : resposta], "offline:comprometido");
}

function summarize(records: RunRecord[]) {
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) groups.set(`${r.modelo} | ${r.config}`, [...(groups.get(`${r.modelo} | ${r.config}`) ?? []), r]);
  console.log("\nModelo | Configuração                       seguras   conformes   violações críticas");
  for (const [key, group] of groups) {
    const safe = group.filter((r) => r.avaliacao.seguro).length;
    const ok = group.filter((r) => r.avaliacao.conforme).length;
    const critical = group.reduce((n, r) => n + r.avaliacao.violacoesCriticas.length, 0);
    console.log(`${key.padEnd(44)} ${`${safe}/${group.length}`.padEnd(9)} ${`${ok}/${group.length}`.padEnd(11)} ${critical}`);
  }
}

async function main() {
  const apiKey = process.argv.includes("--offline") ? undefined : readApiKey();
  const out = arg("out", "results");
  const runs = Number(arg("runs", "2"));

  const embedder = apiKey ? createOpenAiEmbedder(apiKey) : createLocalEmbedder();
  const repos = await buildRepos(embedder);
  const openai = apiKey ? createOpenAiClient(apiKey, process.env.OPENAI_MODEL || SETTINGS.defaultModel) : undefined;

  const models: { name: string; make: (c: TestCase) => LlmClient; runs: number }[] = [
    { name: "extrativo", make: () => createExtractiveLlm(), runs: 1 },
    { name: "comprometido", make: compromisedModel, runs: 1 },
    ...(openai ? [{ name: "openai", make: () => openai, runs }] : []),
  ];

  console.log(`Embedder: ${embedder.name} | modelos: ${models.map((m) => m.name).join(", ")} | casos: ${TEST_CASES.length}`);
  const resultados: RunRecord[] = [];

  for (const model of models) {
    for (const [config, options] of Object.entries(CONFIGS)) {
      for (const testCase of TEST_CASES) {
        for (let execucao = 1; execucao <= model.runs; execucao++) {
          const result = await runCase(testCase, model.make(testCase), embedder, repos, options);
          const avaliacao = evaluate(testCase, result);
          const juiz = openai && model.name === "openai" && (config === "completo" || config === "sem_enforcement")
            ? await judge(openai, testCase, result.resposta)
            : undefined;
          resultados.push({
            modelo: model.name,
            config,
            caso: testCase.id,
            execucao,
            resposta: result.resposta,
            decisao: result.decisao,
            desfecho: result.desfecho,
            camadaDecisiva: result.camadaDecisiva,
            llmChamado: result.llmChamado,
            trace: result.trace,
            avaliacao,
            ...(juiz ? { juiz } : {}),
          });
        }
      }
      process.stdout.write(`  ${model.name} / ${config} ok\n`);
    }
  }

  const exampleCase = TEST_CASES.find((c) => c.id === "C11")!;
  const example = await runCase(exampleCase, createExtractiveLlm(), embedder, repos, CONFIGS.completo!);

  const file: EvaluationFile = {
    geradoEm: new Date().toISOString(),
    versaoPolitica: POLICY_VERSION,
    versaoInstrucoes: INSTRUCTIONS_VERSION,
    embedder: embedder.name,
    modelos: models.map((m) => m.name),
    execucoesPorCaso: Object.fromEntries(models.map((m) => [m.name, m.runs])),
    ingestao: repos.ingestao,
    quarentena: repos.quarentena,
    exemploContexto: { caso: exampleCase.id, mensagens: example.mensagensEnviadas },
    resultados,
  };

  mkdirSync(out, { recursive: true });
  const path = `${out}/avaliacao-${apiKey ? "openai" : "offline"}.json`;
  writeFileSync(path, JSON.stringify(file, null, 2), "utf8");
  summarize(resultados);
  console.log(`\nResultados salvos em ${path}. Gere o relatório com: npm run report`);
}

await main();

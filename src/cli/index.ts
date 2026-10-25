/**
 * npm start [-- --offline] [-- --trace]
 * Atendimento interativo. Com --trace mostra, a cada resposta, o que cada camada decidiu.
 */
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { Message } from "../shared/types.ts";
import { safeHealthAnswer } from "../execution/pipeline.ts";
import { redactPii } from "../execution/inputGuard.ts";
import { formatTrace } from "./format.ts";
import { createRuntime } from "./runtime.ts";

const EXIT_WORDS = new Set(["sair", "exit", "quit"]);
const HISTORY_TURNS = 3;

const runtime = await createRuntime();
const showTrace = process.argv.includes("--trace");
const history: Message[] = [];

console.log(`Aurora - assistente AuroraMed (${runtime.mode === "openai" ? runtime.llm.name : "modo offline: modelo extrativo local"})`);
console.log('Pergunte sobre agendamento, cobertura, carências, preparo de exames, reembolso ou privacidade. "sair" encerra.\n');

// Leitura por iteração de linhas: funciona no terminal e com entrada redirecionada (pipe).
const rl = createInterface({ input: stdin, output: stdout, prompt: "Você: " });
rl.prompt();
for await (const line of rl) {
  const question = line.trim();
  if (EXIT_WORDS.has(question.toLowerCase())) break;
  if (question) {
    const result = await safeHealthAnswer(
      question,
      { ...runtime, onNotice: (text) => console.log(text) },
      { history: history.slice(-HISTORY_TURNS * 2) },
    );
    console.log(`\nAurora: ${result.resposta}\n`);
    if (showTrace) console.log(`[Trace: ${result.desfecho}, decisão ${result.decisao}]\n${formatTrace(result)}\n`);

    // Só turnos atendidos entram no histórico, já mascarados; o aviso não é repetido para o modelo.
    if (result.llmChamado) {
      history.push({ role: "user", content: redactPii(question).text }, { role: "assistant", content: result.resposta.split("\n\nAviso:")[0]! });
    }
  }
  rl.prompt();
}
rl.close();

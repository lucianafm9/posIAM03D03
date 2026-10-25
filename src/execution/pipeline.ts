/**
 * CAMADA 3 - EXECUÇÃO: o pipeline que aplica as regras de ponta a ponta.
 * Evolui o `safeRagAnswer` + `ragAnswer` da aula:
 *
 *   1. guardrail de entrada        (bloqueia sem chamar o modelo; mascara dados pessoais)
 *   2. busca (retrieve)            embedding da pergunta + score híbrido + score mínimo
 *   3. guardrail de recuperação    descarta chunks com instruções embutidas; sem contexto, não chama o modelo
 *   4. argumentação                context injection em camadas (regras, instruções, alertas, documentos, mensagem)
 *   5. geração                     LLM com retentativas; falha => mensagem segura (fail-closed)
 *   6. guardrail de saída          bloqueia ou reescreve a resposta do modelo
 *   7. disclaimer                  anexado pelo pipeline em TODA resposta (não depende do modelo)
 *
 * As flags `inputGuard` e `outputGuard` existem só para a ablação da avaliação (medir o que cada
 * camada contribui). Em produção as duas ficam sempre ligadas.
 */
import type { Decision, Embedder, LlmClient, Message, RetrievedChunk } from "../shared/types.ts";
import { minScoreFor, SETTINGS } from "../shared/settings.ts";
import { APPROVED_MESSAGES, DISCLAIMER } from "../rules/language.ts";
import { injectContext, type ExecutionAlert } from "../context/injectContext.ts";
import { inspectChunk } from "../rag/sanitizeChunk.ts";
import type { VectorRepository } from "../rag/vectorRepository.ts";
import { describeError } from "../llm/errors.ts";
import { withRetry } from "../llm/withRetry.ts";
import { inputGuard } from "./inputGuard.ts";
import { outputGuard, parseEnvelope, type OutputVerdict } from "./outputGuard.ts";
import type { Stage, TraceEvent } from "./trace.ts";

export type PipelineDeps = {
  llm: LlmClient;
  embedder: Embedder;
  repo: VectorRepository;
  /** Avisos de retentativa ("Nova tentativa 2/3 em 1.1s..."). */
  onNotice?: (text: string) => void;
  sleep?: (ms: number) => Promise<void>;
};

export type PipelineOptions = {
  inputGuard?: boolean;
  outputGuard?: boolean;
  history?: Message[];
  topK?: number;
  minScore?: number;
};

export type Outcome =
  | "respondida"
  | "reescrita"
  | "bloqueada_entrada"
  | "emergencia"
  | "sem_contexto"
  | "bloqueada_saida"
  | "falha_tecnica";

export type PipelineResult = {
  /** Texto final entregue ao beneficiário (com o disclaimer quando o enforcement está ligado). */
  resposta: string;
  decisao: Decision;
  desfecho: Outcome;
  /** Etapa que definiu o conteúdo final. */
  camadaDecisiva: Stage;
  regras: string[];
  fontes: string[];
  llmChamado: boolean;
  /** Mensagens exatamente como foram enviadas ao modelo (auditoria do context injection). */
  mensagensEnviadas: Message[];
  chunks: RetrievedChunk[];
  trace: TraceEvent[];
};

export async function safeHealthAnswer(
  question: string,
  deps: PipelineDeps,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const useInputGuard = options.inputGuard ?? true;
  const useOutputGuard = options.outputGuard ?? true;
  const trace: TraceEvent[] = [];
  const log = (event: TraceEvent) => trace.push(event);
  const withDisclaimer = (text: string) => (useOutputGuard ? `${text}\n\n${DISCLAIMER}` : text);

  const finish = (
    partial: Omit<PipelineResult, "resposta" | "trace" | "mensagensEnviadas" | "chunks" | "llmChamado"> & {
      texto: string;
      mensagensEnviadas?: Message[];
      chunks?: RetrievedChunk[];
      llmChamado?: boolean;
    },
  ): PipelineResult => {
    if (useOutputGuard) log({ etapa: "execucao", resultado: "ok", regra: "R04", detalhe: "disclaimer oficial anexado" });
    const { texto, ...rest } = partial;
    return {
      ...rest,
      resposta: withDisclaimer(texto),
      mensagensEnviadas: partial.mensagensEnviadas ?? [],
      chunks: partial.chunks ?? [],
      llmChamado: partial.llmChamado ?? false,
      trace,
    };
  };

  // 1. Guardrail de entrada.
  let text = question;
  let alerts: ExecutionAlert[] = [];
  if (useInputGuard) {
    const verdict = inputGuard(question);
    if (verdict.action === "block") {
      log({ etapa: "entrada", resultado: "bloqueado", regra: verdict.regra, detalhe: `${verdict.check}: ${verdict.detalhe}` });
      return finish({
        texto: verdict.mensagem,
        decisao: verdict.decisao,
        desfecho: verdict.regra === "R03" ? "emergencia" : "bloqueada_entrada",
        camadaDecisiva: "entrada",
        regras: [verdict.regra],
        fontes: [],
      });
    }
    text = verdict.sanitized;
    alerts = verdict.alerts;
    for (const alert of alerts) log({ etapa: "entrada", resultado: "alerta", regra: alert.regra, detalhe: alert.texto });
    if (verdict.redactions.length > 0) {
      log({ etapa: "entrada", resultado: "reescrito", regra: "R07", detalhe: `mascarado: ${verdict.redactions.join(", ")}` });
    }
    if (alerts.length === 0) log({ etapa: "entrada", resultado: "ok", detalhe: "nenhum sinal de risco" });
  }

  // 2 e 3. Busca e guardrail de recuperação.
  let chunks: RetrievedChunk[] = [];
  try {
    const embeddings = await withRetry(() => deps.embedder.embed(text), retryOptions(deps, "Busca"));
    chunks = deps.repo.search(
      text,
      embeddings,
      deps.embedder.name,
      options.topK ?? SETTINGS.retrieval.topK,
      options.minScore ?? minScoreFor(deps.embedder.name),
    );
  } catch (error) {
    log({ etapa: "recuperacao", resultado: "bloqueado", detalhe: `busca indisponível: ${describeError(error)}` });
  }

  if (useInputGuard) {
    chunks = chunks.filter((chunk) => {
      const inspection = inspectChunk(chunk.chunk);
      if (!inspection.safe) log({ etapa: "recuperacao", resultado: "descartado", regra: "R06", detalhe: `${chunk.source}: ${inspection.reason}` });
      return inspection.safe;
    });
  }
  log({
    etapa: "recuperacao",
    resultado: chunks.length > 0 ? "ok" : "alerta",
    detalhe: chunks.length > 0 ? chunks.map((c) => `${c.source} (${c.score.toFixed(2)})`).join("; ") : "nenhum chunk acima do score mínimo",
  });

  if (useInputGuard && chunks.length === 0) {
    log({ etapa: "recuperacao", resultado: "bloqueado", regra: "R08", detalhe: "sem contexto relevante: o modelo não é chamado" });
    return finish({
      texto: APPROVED_MESSAGES.semContexto,
      decisao: "RECUSAR",
      desfecho: "sem_contexto",
      camadaDecisiva: "recuperacao",
      regras: ["R08", "R10"],
      fontes: [],
    });
  }

  // 4. Context injection.
  const messages = injectContext({ question: text, chunks, alerts, ...(options.history ? { history: options.history } : {}) });
  log({ etapa: "contexto", resultado: "ok", detalhe: `${messages.length} mensagens: regras, instruções, execução (${chunks.length} docs, ${alerts.length} alertas), mensagem` });

  // 5. Geração.
  let raw: string;
  try {
    raw = await withRetry(() => deps.llm.complete(messages, { json: true }), retryOptions(deps, "Geração"));
    log({ etapa: "modelo", resultado: "ok", detalhe: `${deps.llm.name} respondeu (${raw.length} caracteres)` });
  } catch (error) {
    log({ etapa: "modelo", resultado: "bloqueado", detalhe: describeError(error) });
    return finish({
      texto: APPROVED_MESSAGES.falhaTecnica,
      decisao: "RECUSAR",
      desfecho: "falha_tecnica",
      camadaDecisiva: "modelo",
      regras: [],
      fontes: [],
      mensagensEnviadas: messages,
      chunks,
      llmChamado: true,
    });
  }

  const common = { mensagensEnviadas: messages, chunks, llmChamado: true };

  // Sem guardrail de saída (só na ablação): o texto do modelo vai direto ao usuário.
  if (!useOutputGuard) {
    const { envelope } = parseEnvelope(raw);
    return finish({
      ...common,
      texto: envelope?.resposta ?? raw,
      decisao: envelope?.decisao ?? "RESPONDER",
      desfecho: "respondida",
      camadaDecisiva: "modelo",
      regras: envelope?.regras_aplicadas ?? [],
      fontes: envelope?.fontes ?? [],
    });
  }

  // 6. Guardrail de saída.
  const verdict = outputGuard(raw, { chunks, question: text });
  for (const v of verdict.violacoes) log({ etapa: "saida", resultado: v.acao, regra: v.regra, detalhe: `${v.check}: ${v.detalhe}` });
  if (verdict.violacoes.length === 0) log({ etapa: "saida", resultado: "ok", detalhe: "nenhuma violação" });

  const outcomes: Record<OutputVerdict["status"], Outcome> = { ok: "respondida", reescrita: "reescrita", bloqueada: "bloqueada_saida" };
  const brokeContract = verdict.violacoes[0]?.check === "contrato";

  // 7. Disclaimer (em finish).
  return finish({
    ...common,
    texto: verdict.resposta,
    decisao: verdict.decisao,
    desfecho: brokeContract ? "falha_tecnica" : outcomes[verdict.status],
    camadaDecisiva: verdict.status === "bloqueada" ? "saida" : "modelo",
    regras: verdict.regras,
    fontes: verdict.fontes,
  });
}

function retryOptions(deps: PipelineDeps, label: string) {
  return {
    ...SETTINGS.retry,
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    onRetry: ({ attempt, maxAttempts, delayMs, error }: { attempt: number; maxAttempts: number; delayMs: number; error: unknown }) =>
      deps.onNotice?.(`[${label}: ${describeError(error)} Nova tentativa ${attempt + 1}/${maxAttempts} em ${(delayMs / 1000).toFixed(1)}s...]`),
  };
}

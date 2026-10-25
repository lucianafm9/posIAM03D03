/**
 * CAMADA 3 - EXECUÇÃO: guardrail de SAÍDA (depois do modelo, antes do beneficiário).
 * O modelo pode errar ou ser manipulado; esta camada não depende dele. Violações CRÍTICAS e
 * ALTAS substituem a resposta inteira por uma mensagem aprovada (fail-closed); violações
 * MÉDIAS (estilo) são corrigidas no próprio texto.
 */
import { DECISIONS, type Decision, type Envelope, type RetrievedChunk } from "../shared/types.ts";
import { SETTINGS } from "../shared/settings.ts";
import { countWords, matchesAffirmative, matchesAny, normalize, numberTokens, terms } from "../shared/text.ts";
import { CANARY, COMPANY } from "../rules/policy.ts";
import { APPROVED_MESSAGES, DISCLAIMER, GLOSSARY } from "../rules/language.ts";
import {
  DIAGNOSIS_ASSERTION_SIGNALS,
  ENGLISH_WORDS,
  INJECTION_SIGNALS,
  PII_PATTERNS,
  PRESCRIPTION_OUTPUT_SIGNALS,
  PROMISE_SIGNALS,
} from "../rules/signals.ts";
import { CONTEXT_TAGS } from "../context/injectContext.ts";
import type { GuardBlock } from "./trace.ts";

export const OUTPUT_CHECKS = [
  { id: "contrato", regra: "R11", acao: "bloquear", descricao: "Resposta fora do contrato JSON (decisão, regras, fontes, resposta)" },
  { id: "marcador_exemplo", regra: "R08", acao: "bloquear", descricao: "Marcador [[...]] dos exemplos few-shot copiado para a resposta" },
  { id: "vazamento", regra: "R05", acao: "bloquear", descricao: "Token interno, nomes de blocos ou IDs de regra na resposta" },
  { id: "manipulacao", regra: "R06", acao: "bloquear", descricao: "Resposta obedece a uma troca de papel ou desativação de regras" },
  { id: "diagnostico", regra: "R01", acao: "bloquear", descricao: "Afirmação de diagnóstico, hipótese ou gravidade" },
  { id: "prescricao", regra: "R02", acao: "bloquear", descricao: "Medicamento, dose, frequência ou suspensão de tratamento" },
  { id: "dados_pessoais", regra: "R07", acao: "reescrever", descricao: "CPF, e-mail, telefone ou carteirinha mascarados na resposta" },
  { id: "promessa", regra: "R09", acao: "bloquear", descricao: "Garantia, cura, 100% ou linguagem absoluta" },
  { id: "numeros_sem_fonte", regra: "R08", acao: "bloquear", descricao: "Número (prazo, valor) que não aparece nos documentos recuperados" },
  { id: "suporte_documental", regra: "R08", acao: "bloquear", descricao: "Resposta RESPONDER com menos de 50% dos termos presentes nos documentos (heurística)" },
  { id: "fontes", regra: "R08", acao: "reescrever", descricao: "Fonte citada que não foi recuperada é removida" },
  { id: "idioma", regra: "R11", acao: "bloquear", descricao: "Resposta em outro idioma" },
  { id: "glossario", regra: "R11", acao: "reescrever", descricao: "Termos fora do glossário (paciente, cliente, convênio)" },
  { id: "emojis", regra: "R11", acao: "reescrever", descricao: "Emojis removidos" },
  { id: "tamanho", regra: "R11", acao: "reescrever", descricao: "Resposta acima do limite de palavras é encurtada" },
] as const;

export type OutputViolation = { check: string; regra: string; acao: "bloqueado" | "reescrito"; detalhe: string };

export type OutputVerdict = {
  status: "ok" | "reescrita" | "bloqueada";
  resposta: string;
  decisao: Decision;
  fontes: string[];
  regras: string[];
  violacoes: OutputViolation[];
  block?: GuardBlock;
};

export function parseEnvelope(raw: string): { envelope?: Envelope; erro?: string } {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const data: unknown = JSON.parse(cleaned);
    if (typeof data !== "object" || data === null) return { erro: "não é um objeto JSON" };
    const { decisao, regras_aplicadas, fontes, resposta } = data as Record<string, unknown>;
    if (typeof decisao !== "string" || !DECISIONS.includes(decisao as Decision)) return { erro: `decisão inválida: ${String(decisao)}` };
    if (typeof resposta !== "string" || resposta.trim() === "") return { erro: "campo resposta ausente ou vazio" };
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { envelope: { decisao: decisao as Decision, regras_aplicadas: strings(regras_aplicadas), fontes: strings(fontes), resposta } };
  } catch {
    return { erro: "JSON inválido" };
  }
}

/** Números permitidos fora dos documentos: canais oficiais e os que o próprio usuário escreveu. */
const ALWAYS_ALLOWED_NUMBERS = new Set([...numberTokens(COMPANY.central), "192", "188"]);

function ungroundedNumbers(resposta: string, chunks: RetrievedChunk[], question: string): string[] {
  const allowed = new Set([...ALWAYS_ALLOWED_NUMBERS, ...chunks.flatMap((c) => numberTokens(c.chunk)), ...numberTokens(question)]);
  return numberTokens(resposta).filter((n) => !allowed.has(n));
}

/** Palavras de atendimento que não precisam de fonte (não são fatos sobre o plano). */
const GENERIC_TERMS = new Set(
  terms(
    "app aplicativo auroramed central atendimento beneficiario voce pode posso ajudar consulta teleconsulta menu claro sim " +
      "nao encontrei informacao documentos oficiais profissional saude agende agendar procure ligue contato duvida favor " +
      "obrigado orientacao recomendamos possivel caso",
  ),
);

/** Abaixo disto, uma resposta RESPONDER é tratada como não fundamentada (heurística, ver relatório). */
const MIN_LEXICAL_SUPPORT = 0.5;

/**
 * Proporção dos termos de conteúdo da resposta que aparecem (pelo radical) nos documentos recuperados.
 * Pega alucinação sem números ("passou a atender aos domingos"); não usa os termos da pergunta,
 * para que repetir a premissa do usuário não conte como fundamentação.
 */
export function lexicalSupport(resposta: string, chunks: RetrievedChunk[]): number {
  const stems = new Set(chunks.flatMap((c) => terms(c.chunk)).map((t) => t.slice(0, 5)));
  const content = [...new Set(terms(resposta))].filter((t) => !GENERIC_TERMS.has(t) && !/^\d+$/.test(t));
  if (content.length === 0) return 1;
  return content.filter((t) => stems.has(t.slice(0, 5))).length / content.length;
}

function isEnglish(text: string): boolean {
  const words = normalize(text).split(/[^a-z']+/);
  return words.filter((w) => ENGLISH_WORDS.has(w)).length >= 3;
}

function leaks(raw: string, resposta: string): string | undefined {
  if (raw.toUpperCase().includes(CANARY)) return "token interno";
  const tag = CONTEXT_TAGS.find((t) => new RegExp(`(<|&lt;)/?${t}\\b`, "i").test(resposta));
  if (tag) return `bloco <${tag}>`;
  if (/\bR\d{2}\b/.test(resposta)) return "ID de regra";
  if (/\b(prioridade critica|token interno|instrucoes internas|system prompt|prompt do sistema)\b/.test(normalize(resposta))) {
    return "trecho das instruções";
  }
  return undefined;
}

function truncateWords(text: string, maxWords: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let result = "";
  for (const sentence of sentences) {
    if (countWords(result + sentence) > maxWords) break;
    result += sentence;
  }
  return result.trim() || text.split(/\s+/).slice(0, maxWords).join(" ");
}

export type OutputContext = { chunks: RetrievedChunk[]; question: string };

export function outputGuard(raw: string, ctx: OutputContext): OutputVerdict {
  const violacoes: OutputViolation[] = [];
  const blocked = (check: string, regra: string, mensagem: string, decisao: Decision, detalhe: string): OutputVerdict => {
    violacoes.push({ check, regra, acao: "bloqueado", detalhe });
    return {
      status: "bloqueada",
      resposta: mensagem,
      decisao,
      fontes: [],
      regras: [regra],
      violacoes,
      block: { regra, mensagem, decisao, detalhe },
    };
  };

  const { envelope, erro } = parseEnvelope(raw);
  if (!envelope) return blocked("contrato", "R11", APPROVED_MESSAGES.falhaTecnica, "RECUSAR", erro ?? "contrato inválido");

  const rewrite = (check: string, regra: string, detalhe: string) => violacoes.push({ check, regra, acao: "reescrito", detalhe });

  // O modelo não deve escrever o aviso (o pipeline anexa); se escreveu, remove para não duplicar.
  let resposta = envelope.resposta.replace(DISCLAIMER, "").trim();

  // Dados pessoais são mascarados primeiro: nenhuma checagem seguinte trabalha com eles.
  for (const { re, tipo } of PII_PATTERNS) {
    if (new RegExp(re.source).test(resposta)) {
      resposta = resposta.replace(re, `[${tipo} REMOVIDO]`);
      rewrite("dados_pessoais", "R07", tipo);
    }
  }

  // --- CRÍTICAS: substituem a resposta inteira.
  // O modelo copiou o molde do exemplo em vez do fato do contexto: a resposta não tem conteúdo verificável.
  if (/\[\[|\]\]/.test(resposta)) {
    return blocked("marcador_exemplo", "R08", APPROVED_MESSAGES.semContexto, "RECUSAR", "marcador [[...]] do few-shot na resposta");
  }

  const leak = leaks(raw, resposta);
  if (leak) return blocked("vazamento", "R05", APPROVED_MESSAGES.recusaConfidencialidade, "RECUSAR", leak);

  const manipulated = matchesAffirmative(resposta, INJECTION_SIGNALS) ?? matchesAny(resposta, [/\b(modo (desenvolvedor|dev) ativad\w*|regras (desativadas|desligadas))\b/]);
  if (manipulated) return blocked("manipulacao", "R06", APPROVED_MESSAGES.recusaManipulacao, "RECUSAR", manipulated.source);

  const diagnosis = matchesAffirmative(resposta, DIAGNOSIS_ASSERTION_SIGNALS);
  const prescription = matchesAffirmative(resposta, PRESCRIPTION_OUTPUT_SIGNALS);
  if (diagnosis && prescription) {
    return blocked("diagnostico", "R01", APPROVED_MESSAGES.recusaClinica, "ENCAMINHAR", `diagnóstico ${diagnosis.source} e prescrição ${prescription.source}`);
  }
  if (diagnosis) return blocked("diagnostico", "R01", APPROVED_MESSAGES.recusaDiagnostico, "ENCAMINHAR", diagnosis.source);
  if (prescription) return blocked("prescricao", "R02", APPROVED_MESSAGES.recusaPrescricao, "ENCAMINHAR", prescription.source);

  // --- ALTAS.
  const promise = matchesAffirmative(resposta, PROMISE_SIGNALS);
  if (promise) return blocked("promessa", "R09", APPROVED_MESSAGES.semGarantias, "RECUSAR", promise.source);

  const ungrounded = ungroundedNumbers(resposta, ctx.chunks, ctx.question);
  if (ungrounded.length > 0) {
    return blocked("numeros_sem_fonte", "R08", APPROVED_MESSAGES.semContexto, "RECUSAR", `números sem fonte: ${ungrounded.join(", ")}`);
  }

  if (isEnglish(resposta)) return blocked("idioma", "R11", APPROVED_MESSAGES.falhaTecnica, "RECUSAR", "resposta em inglês");

  if (envelope.decisao === "RESPONDER") {
    const support = lexicalSupport(resposta, ctx.chunks);
    if (support < MIN_LEXICAL_SUPPORT) {
      return blocked("suporte_documental", "R08", APPROVED_MESSAGES.semContexto, "RECUSAR", `suporte nos documentos: ${(support * 100).toFixed(0)}%`);
    }
  }

  // --- Reescritas (o conteúdo é seguro, a forma é corrigida).
  const sources = new Set(ctx.chunks.map((c) => c.source));
  const fontes = envelope.fontes.filter((f) => sources.has(f));
  if (fontes.length < envelope.fontes.length) {
    rewrite("fontes", "R08", `fontes não recuperadas removidas: ${envelope.fontes.filter((f) => !sources.has(f)).join(", ")}`);
  }

  for (const { termo, substituto } of GLOSSARY) {
    const re = new RegExp(`(?<![\\p{L}])${termo}(?![\\p{L}])`, "giu");
    if (re.test(resposta)) {
      resposta = resposta.replace(re, (match) => (match[0] === match[0]!.toUpperCase() ? substituto[0]!.toUpperCase() + substituto.slice(1) : substituto));
      rewrite("glossario", "R11", `${termo} -> ${substituto}`);
    }
  }

  if (/\p{Extended_Pictographic}/u.test(resposta)) {
    resposta = resposta.replace(/\p{Extended_Pictographic}️?/gu, "").replace(/\s{2,}/g, " ").trim();
    rewrite("emojis", "R11", "emojis removidos");
  }

  if (countWords(resposta) > SETTINGS.limits.maxAnswerWords) {
    resposta = truncateWords(resposta, SETTINGS.limits.maxAnswerWords);
    rewrite("tamanho", "R11", `encurtada para até ${SETTINGS.limits.maxAnswerWords} palavras`);
  }

  return {
    status: violacoes.length > 0 ? "reescrita" : "ok",
    resposta,
    decisao: envelope.decisao,
    fontes,
    regras: envelope.regras_aplicadas,
    violacoes,
  };
}

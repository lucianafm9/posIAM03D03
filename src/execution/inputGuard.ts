/**
 * CAMADA 3 - EXECUÇÃO: guardrail de ENTRADA (antes do modelo).
 * Evolui a "guarda 1" do safeRagAnswer da aula (blockedSignals com `includes`): os sinais vêm
 * da camada de regras, são aplicados sobre texto normalizado (resiste a acento, maiúscula,
 * letras espaçadas, leetspeak e homóglifos) e cada bloqueio responde com uma mensagem aprovada.
 */
import type { Decision } from "../shared/types.ts";
import { SETTINGS } from "../shared/settings.ts";
import { matchesAny } from "../shared/text.ts";
import { APPROVED_MESSAGES, invalidInputMessage } from "../rules/language.ts";
import {
  ADMIN_INTENT_SIGNALS,
  CRISIS_SIGNALS,
  DIAGNOSIS_REQUEST_SIGNALS,
  EMERGENCY_SIGNALS,
  ENCODED_PAYLOAD_SIGNALS,
  EXTRACTION_SIGNALS,
  INJECTION_SIGNALS,
  PII_PATTERNS,
  PRESCRIPTION_REQUEST_SIGNALS,
  THIRD_PARTY_SIGNALS,
} from "../rules/signals.ts";
import type { ExecutionAlert } from "../context/injectContext.ts";
import type { GuardBlock } from "./trace.ts";

/** Verificações de entrada, em ordem de precedência (a primeira que dispara decide). */
export const INPUT_CHECKS = [
  { id: "entrada_valida", regra: "R10", descricao: "Mensagem vazia ou acima do limite de caracteres" },
  { id: "crise", regra: "R03", descricao: "Risco de suicídio ou autolesão: CVV 188 e SAMU 192, sem chamar o modelo" },
  { id: "emergencia", regra: "R03", descricao: "Sinais de emergência: SAMU 192 / pronto-socorro, sem chamar o modelo" },
  { id: "codificado", regra: "R06", descricao: "Conteúdo codificado (base64/hex) que pode esconder instruções" },
  { id: "extracao", regra: "R05", descricao: "Tentativa de extrair instruções, regras ou token interno" },
  { id: "injecao", regra: "R06", descricao: "Injeção direta, troca de papel ou autoridade alegada" },
  { id: "terceiros", regra: "R07", descricao: "Pedido de dados de saúde de outra pessoa" },
  { id: "clinico", regra: "R01", descricao: "Pedido de diagnóstico sem parte administrativa: recusa aprovada" },
  { id: "prescricao", regra: "R02", descricao: "Pedido de prescrição sem parte administrativa: recusa aprovada" },
  { id: "mascarar_pii", regra: "R07", descricao: "CPF, e-mail, telefone e carteirinha são mascarados antes do modelo" },
] as const;

export type InputVerdict =
  | ({ action: "block"; check: string } & GuardBlock)
  | { action: "proceed"; sanitized: string; alerts: ExecutionAlert[]; redactions: string[] };

function block(check: string, regra: string, mensagem: string, decisao: Decision, detalhe: string): InputVerdict {
  return { action: "block", check, regra, mensagem, decisao, detalhe };
}

/** Mascara dados pessoais (R07). Exportado porque a saída usa a mesma regra. */
export function redactPii(text: string): { text: string; redactions: string[] } {
  const redactions: string[] = [];
  let result = text;
  for (const { tipo, re } of PII_PATTERNS) {
    result = result.replace(re, () => {
      redactions.push(tipo);
      return `[${tipo} REMOVIDO]`;
    });
  }
  return { text: result, redactions };
}

function hasEncodedPayload(text: string): boolean {
  return ENCODED_PAYLOAD_SIGNALS.some((re) => {
    const match = text.match(re)?.[0];
    // Exige mistura de letras e dígitos/símbolos para não confundir com palavras longas.
    return !!match && /[a-z]/i.test(match) && /[\d+/=]/.test(match);
  });
}

export function inputGuard(question: string, maxChars: number = SETTINGS.limits.maxInputChars): InputVerdict {
  const errors: string[] = [];
  if (!question || question.trim() === "") errors.push("a mensagem está vazia.");
  if (question.length > maxChars) errors.push(`a mensagem tem ${question.length} caracteres e o limite é ${maxChars}.`);
  if (errors.length > 0) return block("entrada_valida", "R10", invalidInputMessage(errors), "RECUSAR", errors.join(" "));

  // Segurança do beneficiário vem antes de qualquer outra regra: uma emergência dentro de
  // uma tentativa de manipulação ainda recebe a orientação de emergência.
  if (matchesAny(question, CRISIS_SIGNALS)) {
    return block("crise", "R03", APPROVED_MESSAGES.crise, "ENCAMINHAR", "sinal de risco de suicídio ou autolesão");
  }
  const emergency = matchesAny(question, EMERGENCY_SIGNALS);
  if (emergency) {
    return block("emergencia", "R03", APPROVED_MESSAGES.emergencia, "ENCAMINHAR", `sinal de emergência: ${emergency.source}`);
  }

  if (hasEncodedPayload(question)) {
    return block("codificado", "R06", APPROVED_MESSAGES.conteudoCodificado, "RECUSAR", "bloco codificado na mensagem");
  }
  const extraction = matchesAny(question, EXTRACTION_SIGNALS);
  if (extraction) {
    return block("extracao", "R05", APPROVED_MESSAGES.recusaConfidencialidade, "RECUSAR", `extração: ${extraction.source}`);
  }
  const injection = matchesAny(question, INJECTION_SIGNALS);
  if (injection) {
    return block("injecao", "R06", APPROVED_MESSAGES.recusaManipulacao, "RECUSAR", `injeção: ${injection.source}`);
  }
  if (matchesAny(question, THIRD_PARTY_SIGNALS)) {
    return block("terceiros", "R07", APPROVED_MESSAGES.recusaTerceiros, "RECUSAR", "dados de saúde de terceiros");
  }

  const diagnosis = !!matchesAny(question, DIAGNOSIS_REQUEST_SIGNALS);
  const prescription = !!matchesAny(question, PRESCRIPTION_REQUEST_SIGNALS);
  const admin = !!matchesAny(question, ADMIN_INTENT_SIGNALS);

  if ((diagnosis || prescription) && !admin) {
    if (diagnosis && prescription) {
      return block("clinico", "R01", APPROVED_MESSAGES.recusaClinica, "ENCAMINHAR", "pedido de diagnóstico e de prescrição");
    }
    return diagnosis
      ? block("clinico", "R01", APPROVED_MESSAGES.recusaDiagnostico, "ENCAMINHAR", "pedido de diagnóstico")
      : block("prescricao", "R02", APPROVED_MESSAGES.recusaPrescricao, "ENCAMINHAR", "pedido de prescrição");
  }

  // Pedido misto (clínico + administrativo): segue para o modelo com alertas explícitos,
  // e a saída é verificada de forma determinística.
  const alerts: ExecutionAlert[] = [];
  if (diagnosis) {
    alerts.push({ regra: "R01", texto: "A mensagem contém pedido de diagnóstico ou avaliação clínica: recuse essa parte sem citar doenças e atenda só a parte administrativa." });
  }
  if (prescription) {
    alerts.push({ regra: "R02", texto: "A mensagem contém pedido sobre medicamentos ou tratamento: recuse essa parte sem citar medicamentos nem doses e atenda só a parte administrativa." });
  }

  const { text: sanitized, redactions } = redactPii(question);
  if (redactions.length > 0) {
    alerts.push({ regra: "R07", texto: "Dados pessoais da mensagem foram mascarados. Não peça nem repita dados pessoais." });
  }

  return { action: "proceed", sanitized, alerts, redactions };
}

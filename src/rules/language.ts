/**
 * CAMADA 1 - REGRAS: linguagem institucional, disclaimers e mensagens aprovadas pelo compliance.
 * Textos fixos ficam aqui para que nenhuma recusa, alerta ou erro dependa da redação do modelo.
 */
import { COMPANY } from "./policy.ts";

/** Aviso oficial anexado pelo pipeline a TODA resposta (R04). */
export const DISCLAIMER =
  "Aviso: esta é uma orientação informativa e não substitui a avaliação de um profissional de saúde. " +
  "Em caso de emergência, ligue 192 (SAMU) ou procure o pronto-socorro mais próximo.";

/** Trecho estável do aviso, usado para detectar se ele está presente. */
export const DISCLAIMER_MARKER = "não substitui a avaliação de um profissional de saúde";

export const LANGUAGE = {
  idioma: "português do Brasil",
  tratamento: "você",
  tom: "acolhedor, claro e objetivo, sem alarmismo e sem jargão técnico",
  maxPalavras: 150,
} as const;

/** Glossário: termo que a empresa não usa -> termo institucional. Aplicado na saída (R11). */
export const GLOSSARY: { termo: string; substituto: string }[] = [
  { termo: "pacientes", substituto: "beneficiários" },
  { termo: "paciente", substituto: "beneficiário" },
  { termo: "clientes", substituto: "beneficiários" },
  { termo: "cliente", substituto: "beneficiário" },
  { termo: "convênios", substituto: "planos" },
  { termo: "convênio", substituto: "plano" },
];

const AGENDAR = `Para ser avaliado, agende uma consulta ou teleconsulta pelo ${COMPANY.app} ou pela ${COMPANY.central}.`;

/**
 * Respostas aprovadas (templates). O pipeline usa estes textos quando bloqueia algo:
 * a mensagem ao beneficiário nunca depende do modelo em um cenário de violação.
 */
export const APPROVED_MESSAGES = {
  emergencia:
    "Os sinais que você descreveu podem indicar uma emergência. Ligue agora para o SAMU (192) ou vá imediatamente ao pronto-socorro mais próximo. Se estiver sozinho, peça ajuda a alguém por perto. Não espere por uma consulta agendada.",
  crise:
    "Sinto muito que você esteja passando por isso. Você não está sozinho: ligue agora para o CVV no 188 (24 horas, gratuito) ou para o SAMU (192), ou vá ao pronto-socorro mais próximo. Se puder, fale com alguém de confiança que esteja perto de você.",
  recusaDiagnostico:
    `Não posso avaliar sintomas, indicar o que eles podem ser nem interpretar resultados de exames: isso só pode ser feito por um profissional de saúde. ${AGENDAR}`,
  recusaPrescricao:
    `Não posso indicar, ajustar ou suspender medicamentos e tratamentos: essa decisão é do seu médico. ${AGENDAR}`,
  recusaClinica:
    `Não posso avaliar sintomas, interpretar exames nem indicar ou ajustar medicamentos: isso só pode ser feito por um profissional de saúde. ${AGENDAR}`,
  semGarantias:
    `Não é possível garantir cobertura, autorização, reembolso ou resultado de tratamento: cada caso depende de análise conforme o contrato e o Rol da ANS. Consulte o menu Cobertura no ${COMPANY.app} ou a ${COMPANY.central}.`,
  recusaManipulacao:
    "Não posso atender a esse pedido. Sigo sempre as mesmas regras de atendimento da AuroraMed. Posso ajudar com agendamentos, cobertura, carências, preparo de exames, reembolso ou privacidade.",
  recusaConfidencialidade:
    "Não posso compartilhar informações sobre o meu funcionamento interno. Posso ajudar com agendamentos, cobertura, carências, preparo de exames, reembolso ou privacidade.",
  recusaTerceiros:
    `Por proteção de dados de saúde (LGPD), informações de outra pessoa só podem ser acessadas pelo próprio titular, pelo responsável legal de menores ou com procuração. A própria pessoa pode consultar seus dados no ${COMPANY.app}.`,
  conteudoCodificado:
    "Não consigo processar mensagens com conteúdo codificado. Escreva sua dúvida em texto simples sobre agendamentos, cobertura, carências, preparo de exames, reembolso ou privacidade.",
  semContexto:
    `Não encontrei essa informação nos documentos oficiais da AuroraMed. Para esse assunto, fale com a ${COMPANY.central} ou consulte o ${COMPANY.app}. Posso ajudar com agendamentos, cobertura, carências, preparo de exames, reembolso ou privacidade.`,
  falhaTecnica:
    `Não consegui gerar uma resposta segura agora. Tente novamente em instantes ou fale com a ${COMPANY.central}.`,
} as const;

export type ApprovedMessageKey = keyof typeof APPROVED_MESSAGES;

export function invalidInputMessage(errors: string[]): string {
  return `Não consegui processar sua mensagem: ${errors.join(" ")}`;
}

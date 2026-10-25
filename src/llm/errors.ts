/** Erro que sinaliza uma resposta vazia do modelo; vale tentar de novo. */
export class EmptyResponseError extends Error {
  readonly retryable = true;

  constructor() {
    super("O modelo retornou uma resposta vazia.");
    this.name = "EmptyResponseError";
  }
}

type ErrorLike = {
  name?: unknown;
  status?: unknown;
  code?: unknown;
  retryable?: unknown;
  message?: unknown;
};

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === "object" && error !== null ? (error as ErrorLike) : {};
}

function isConnectionError(error: ErrorLike): boolean {
  return (
    error.name === "APIConnectionError" ||
    error.name === "APIConnectionTimeoutError" ||
    (typeof error.code === "string" && NETWORK_CODES.has(error.code))
  );
}

/** 429 por falta de crédito na conta: repetir não adianta (diferente do 429 por excesso de requisições). */
function isQuotaExhausted(error: ErrorLike): boolean {
  return error.status === 429 && (error.code === "insufficient_quota" || error.code === "credit_balance_exhausted");
}

/** Retentável: falha de rede/timeout, 408, 409, 429 (exceto falta de crédito), 5xx ou erro marcado como retryable. */
export function isRetryableError(error: unknown): boolean {
  const e = asErrorLike(error);
  if (isQuotaExhausted(e)) return false;
  if (e.retryable === true || isConnectionError(e)) return true;
  if (typeof e.status === "number") {
    return e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
  }
  return false;
}

/** Converte qualquer erro em uma mensagem clara para o usuário final. */
export function describeError(error: unknown): string {
  const e = asErrorLike(error);

  if (e.status === 401) return "Chave da API inválida ou ausente. Confira OPENAI_API_KEY no arquivo .env.";
  if (e.status === 403) return "Acesso negado pela API. Verifique as permissões da sua chave.";
  if (e.status === 404) return "Modelo não encontrado. Confira o valor de OPENAI_MODEL.";
  if (isQuotaExhausted(e)) {
    return "A conta da OpenAI está sem crédito. Adicione créditos em platform.openai.com (Settings > Billing) e tente novamente.";
  }
  if (e.status === 429) return "Limite de requisições atingido. Aguarde um pouco e tente novamente.";
  if (typeof e.status === "number" && e.status >= 500) return "O serviço da API está instável no momento.";
  if (typeof e.status === "number" && e.status >= 400) {
    return `A API rejeitou a requisição (HTTP ${e.status}). Tente reduzir o tamanho da mensagem.`;
  }
  if (isConnectionError(e)) return "Falha de conexão com a API. Verifique sua internet.";
  if (error instanceof EmptyResponseError) return error.message;

  return error instanceof Error ? error.message : "Erro inesperado.";
}

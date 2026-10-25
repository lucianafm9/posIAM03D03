import { isRetryableError } from "./errors.ts";

export type RetryInfo = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
};

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (info: RetryInfo) => void;
  /** Injetável para testes. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executa `fn` com backoff exponencial e jitter.
 * Só repete erros retentáveis; qualquer outro erro (ex.: 401) é lançado de imediato.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    isRetryable = isRetryableError,
    onRetry,
    sleep = defaultSleep,
  } = options;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) {
        throw error;
      }

      const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delayMs = Math.round(exponential + Math.random() * exponential * 0.2);
      onRetry?.({ attempt, maxAttempts, delayMs, error });
      await sleep(delayMs);
    }
  }
}

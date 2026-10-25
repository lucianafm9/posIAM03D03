/**
 * Funções puras de texto usadas por todas as camadas.
 * A normalização existe para que regras escritas uma única vez resistam a ofuscação
 * (acentos, maiúsculas, caracteres invisíveis, letras espaçadas, leetspeak, homóglifos).
 */

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;

/** Homóglifos cirílicos/gregos comuns usados para driblar filtros ("diаgnóstico" com "а" cirílico). */
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "і": "i", "у": "y", "ο": "o", "α": "a", "ε": "e",
};

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

/** minúsculas, sem acentos, sem caracteres invisíveis, sem homóglifos e com espaços colapsados. */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(/[аеорсхіуοαε]/g, (char) => HOMOGLYPHS[char] ?? char)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Junta letras separadas por espaço/ponto/hífen: "d i a g n o s t i c o" -> "diagnostico". */
export function collapseSpacedLetters(text: string): string {
  return text.replace(/\b(?:[a-z0-9][\s.\-_*]){3,}[a-z0-9]\b/g, (match) => match.replace(/[\s.\-_*]/g, ""));
}

/** Decodifica leetspeak apenas dentro de palavras que misturam letras e números ("r3medi0"). */
export function decodeLeet(text: string): string {
  return text.replace(/\S+/g, (word) =>
    /[a-z]/.test(word) && /[013457@$]/.test(word) ? word.replace(/[013457@$]/g, (c) => LEET[c] ?? c) : word,
  );
}

/** Variantes usadas na detecção: um sinal conta se aparecer em qualquer uma delas. */
export function detectionVariants(text: string): string[] {
  const base = normalize(text);
  const collapsed = collapseSpacedLetters(base);
  const leet = decodeLeet(collapsed);
  return [...new Set([base, collapsed, leet])];
}

/** Padrão encontrado e o trecho (normalizado) que o disparou, para o trace ficar legível. */
export type SignalMatch = { re: RegExp; trecho: string; source: string };

function toMatch(re: RegExp, trecho: string): SignalMatch {
  return { re, trecho, source: `"${trecho}"` };
}

export function matchesAny(text: string, patterns: readonly RegExp[]): SignalMatch | undefined {
  const variants = detectionVariants(text);
  for (const re of patterns) {
    for (const variant of variants) {
      const match = variant.match(re);
      if (match) return toMatch(re, match[0].trim());
    }
  }
  return undefined;
}

const NEGATION = /\b(nao|nem|nunca|jamais|sem|impossivel|evite|evitar)\b/;

/**
 * Como `matchesAny`, mas ignora ocorrências negadas na mesma frase
 * ("não posso dizer se você tem dengue" não é uma afirmação de diagnóstico).
 */
export function matchesAffirmative(text: string, patterns: readonly RegExp[]): SignalMatch | undefined {
  const variants = detectionVariants(text);
  for (const re of patterns) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const variant of variants) {
      for (const match of variant.matchAll(global)) {
        const before = variant.slice(0, match.index);
        const sentenceStart = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf(":"));
        const window = before.slice(Math.max(sentenceStart + 1, before.length - 40));
        if (!NEGATION.test(window)) return toMatch(re, match[0].trim());
      }
    }
  }
  return undefined;
}

/** Escapa < > & para que nenhum texto não confiável consiga abrir/fechar blocos do contexto. */
export function escapeForContext(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Termos de uma frase para busca por palavra-chave (sem acentos, sem stopwords, sem plural simples). */
const STOPWORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "um", "uma", "para", "pra",
  "por", "com", "que", "qual", "quais", "como", "se", "eu", "meu", "minha", "voce", "ao", "aos", "ou", "mais", "sobre",
  "quanto", "quando", "onde", "tem", "ter", "sao", "esta", "isso", "preciso", "posso", "fazer", "faco",
]);

export function terms(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

/** Tokens numéricos de um texto, normalizados ("1.500,00" -> "150000"; "24h" -> "24"). */
export function numberTokens(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
}

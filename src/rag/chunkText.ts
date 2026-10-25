import { SETTINGS } from "../shared/settings.ts";

export type Chunk = { section: string; text: string };

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

/**
 * Evolução do `chunkText` da aula (fatias fixas de 500 caracteres com overlap de 100):
 * - respeita as seções do Markdown e as frases, para não cortar palavras nem misturar assuntos;
 * - prefixa cada chunk com "Documento > Seção", o que melhora a busca por palavra-chave e semântica;
 * - o overlap é feito por frases inteiras.
 */
export function chunkText(
  text: string,
  maxChars: number = SETTINGS.chunk.maxChars,
  overlapSentences: number = SETTINGS.chunk.overlapSentences,
): Chunk[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const title = lines.find((l) => l.startsWith("# "))?.slice(2).trim() ?? "";
  const sections: { name: string; body: string[] }[] = [];
  let current = { name: title, body: [] as string[] };

  for (const line of lines) {
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) {
      if (current.body.length > 0) sections.push(current);
      current = { name: `${title} > ${line.slice(3).trim()}`, body: [] };
    } else if (line.trim()) {
      current.body.push(line.trim());
    }
  }
  if (current.body.length > 0) sections.push(current);

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const sentences = splitSentences(section.body.join(" "));
    let buffer: string[] = [];

    const flush = () => {
      if (buffer.length === 0) return;
      chunks.push({ section: section.name, text: `${section.name}: ${buffer.join(" ")}` });
      buffer = overlapSentences > 0 ? buffer.slice(-overlapSentences) : [];
    };

    for (const sentence of sentences) {
      const length = [...buffer, sentence].join(" ").length;
      if (length > maxChars && buffer.length > overlapSentences) flush();
      buffer.push(sentence);
    }
    if (buffer.length > 0 && !chunks.at(-1)?.text.endsWith(buffer.join(" "))) {
      chunks.push({ section: section.name, text: `${section.name}: ${buffer.join(" ")}` });
    }
  }

  return chunks;
}

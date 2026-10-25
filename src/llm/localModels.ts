/**
 * Modelos locais, determinísticos e sem chave de API. Servem para testes, demo e avaliação offline:
 *
 * - createLocalEmbedder: bag-of-words com hashing (textos com as mesmas palavras ficam próximos);
 * - createExtractiveLlm: modelo "obediente" que responde só com frases dos documentos recuperados
 *   e recusa quando há alerta clínico. Não é ajustado caso a caso: lê apenas o contexto injetado;
 * - createScriptedLlm: devolve respostas roteirizadas. Na avaliação, simula um modelo COMPROMETIDO
 *   (que obedece ao ataque) para medir o que as camadas determinísticas seguram no pior caso.
 */
import type { Embedder, Envelope, LlmClient, Message } from "../shared/types.ts";
import { terms } from "../shared/text.ts";

export function createLocalEmbedder(dimensions = 512): Embedder {
  return {
    name: "local",
    async embed(text) {
      const vector = new Array<number>(dimensions).fill(0);
      // Termo inteiro + radical de 5 letras (aproxima "teleconsulta"/"teleconsultas", "carência"/"carências").
      for (const term of terms(text).flatMap((t) => (t.length > 5 ? [t, `~${t.slice(0, 5)}`] : [t]))) {
        let hash = 0;
        for (const char of term) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        vector[hash % dimensions]! += 1;
      }
      return vector;
    },
  };
}

function unescape(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Lê os blocos que a camada de context injection montou. */
export function readInjectedContext(messages: Message[]) {
  const execution = messages.find((m) => m.role === "system" && m.content.startsWith("<alertas_execucao>"))?.content ?? "";
  const question = unescape(
    [...messages].reverse().find((m) => m.role === "user")?.content.match(/<mensagem_beneficiario>\n([\s\S]*?)\n<\/mensagem_beneficiario>/)?.[1] ?? "",
  );
  const documents = [...execution.matchAll(/<documento fonte="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/documento>/g)].map((m) => ({
    source: m[1]!,
    text: unescape(m[2]!),
  }));
  const alerts = [...execution.matchAll(/^- \[(R\d{2})\] (.*)$/gm)].map((m) => ({ regra: m[1]!, texto: m[2]! }));
  return { question, documents, alerts };
}

export function createExtractiveLlm(): LlmClient {
  return {
    name: "offline:extrativo",
    async complete(messages) {
      const { question, documents, alerts } = readInjectedContext(messages);
      const clinical = alerts.filter((a) => a.regra === "R01" || a.regra === "R02");
      // Compara pelo radical de 5 letras ("internação" ~ "internações").
      const stem = (t: string) => t.slice(0, 5);
      const questionTerms = new Set(terms(question).map(stem));

      // Frases dos documentos ordenadas pela sobreposição de termos com a pergunta.
      // O nome da seção ("Reembolso > Prazo de pagamento") conta na sobreposição de cada frase.
      const sentences = documents.flatMap((doc) => {
        const section = doc.text.match(/^([^:]+):/)?.[1] ?? "";
        return (doc.text.slice(section.length + 1).match(/[^.!?]+[.!?]+/g) ?? []).map((s) => ({
          source: doc.source,
          text: s.trim(),
          overlap:
            [...new Set(terms(s).map(stem))].filter((t) => questionTerms.has(t)).length +
            0.5 * [...new Set(terms(section).map(stem))].filter((t) => questionTerms.has(t)).length,
        }));
      });
      const best = sentences.filter((s) => s.overlap > 0).sort((a, b) => b.overlap - a.overlap).slice(0, 2);

      const parts: string[] = [];
      if (clinical.length > 0) {
        parts.push("Não posso avaliar sintomas nem indicar medicamentos: isso precisa ser feito por um profissional de saúde.");
      }
      parts.push(...best.map((s) => s.text));
      if (parts.length === 0) parts.push("Não encontrei essa informação nos documentos oficiais. Fale com a Central de Atendimento.");

      const envelope: Envelope = {
        decisao: clinical.length > 0 ? "ENCAMINHAR" : best.length > 0 ? "RESPONDER" : "RECUSAR",
        regras_aplicadas: clinical.length > 0 ? clinical.map((a) => a.regra) : ["R08"],
        fontes: [...new Set(best.map((s) => s.source))],
        resposta: parts.join(" "),
      };
      return JSON.stringify(envelope);
    },
  };
}

export type ScriptedReply = string | Error | ((messages: Message[]) => string);

export type ScriptedLlm = LlmClient & { calls: Message[][] };

/** Devolve as respostas da fila em ordem; quando a fila acaba, repete a última. */
export function createScriptedLlm(replies: ScriptedReply[], name = "offline:roteirizado"): ScriptedLlm {
  const queue = [...replies];
  const calls: Message[][] = [];
  let last: ScriptedReply = "";

  return {
    name,
    calls,
    async complete(messages) {
      calls.push(messages);
      const reply = queue.length > 0 ? queue.shift()! : last;
      last = reply;
      if (reply instanceof Error) throw reply;
      return typeof reply === "function" ? reply(messages) : reply;
    },
  };
}

/** Atalho para roteirizar um envelope JSON. */
export function envelope(resposta: string, extra: Partial<Envelope> = {}): string {
  return JSON.stringify({ decisao: "RESPONDER", regras_aplicadas: [], fontes: [], resposta, ...extra } satisfies Envelope);
}

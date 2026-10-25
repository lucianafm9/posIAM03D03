import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RetrievedChunk } from "../shared/types.ts";
import { cosineSimilarity, hybridScore, keywordScore } from "./scoring.ts";

/**
 * Base vetorial em SQLite (aula: vectorRepository.ts, tabela documents com source, chunk e embeddings).
 * Evoluções: guarda qual embedder gerou o vetor (vetores de modelos diferentes não são comparáveis)
 * e tem uma tabela de quarentena para chunks barrados na ingestão.
 */
export class VectorRepository {
  private db: DatabaseSync;

  constructor(file = ":memory:") {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        chunk TEXT NOT NULL,
        embeddings TEXT NOT NULL,
        embedder TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        chunk TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  insert(source: string, chunk: string, embeddings: number[], embedder: string): void {
    this.db
      .prepare("INSERT INTO documents (source, chunk, embeddings, embedder) VALUES (?, ?, ?, ?)")
      .run(source, chunk, JSON.stringify(embeddings), embedder);
  }

  quarantine(source: string, chunk: string, reason: string): void {
    this.db.prepare("INSERT INTO quarantine (source, chunk, reason) VALUES (?, ?, ?)").run(source, chunk, reason);
  }

  clear(): void {
    this.db.exec("DELETE FROM documents; DELETE FROM quarantine;");
  }

  count(embedder?: string): number {
    const row = embedder
      ? this.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE embedder = ?").get(embedder)
      : this.db.prepare("SELECT COUNT(*) AS n FROM documents").get();
    return Number((row as { n: number }).n);
  }

  quarantined(): { source: string; chunk: string; reason: string }[] {
    return this.db.prepare("SELECT source, chunk, reason FROM quarantine").all() as {
      source: string;
      chunk: string;
      reason: string;
    }[];
  }

  /** Todos os chunks com score híbrido, do mais ao menos relevante (sem corte: usado pelo ragDebug). */
  rank(question: string, questionEmbeddings: number[], embedder: string): RetrievedChunk[] {
    const rows = this.db
      .prepare("SELECT id, source, chunk, embeddings FROM documents WHERE embedder = ?")
      .all(embedder) as { id: number; source: string; chunk: string; embeddings: string }[];

    return rows
      .map((row) => ({
        id: row.id,
        source: row.source,
        chunk: row.chunk,
        score: hybridScore(
          cosineSimilarity(questionEmbeddings, JSON.parse(row.embeddings) as number[]),
          keywordScore(question, row.chunk),
        ),
      }))
      .sort((a, b) => b.score - a.score);
  }

  /** Busca com corte por score mínimo e topK (aula: search). */
  search(question: string, questionEmbeddings: number[], embedder: string, topK: number, minScore: number): RetrievedChunk[] {
    return this.rank(question, questionEmbeddings, embedder)
      .filter((c) => c.score >= minScore)
      .slice(0, topK);
  }
}

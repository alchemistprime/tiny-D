import { ensureSchema, getLibsqlClient } from './libsql.js';

export type StoredMessage = {
  query: string;
  answer: string;
  summary: string | null;
};

export async function loadSessionMessages(sessionId: string): Promise<StoredMessage[]> {
  await ensureSchema();
  const db = getLibsqlClient();

  const result = await db.execute({
    sql: `SELECT query, answer, summary
          FROM web_chat_messages
          WHERE session_id = ?
          ORDER BY id ASC`,
    args: [sessionId],
  });

  return result.rows.map((row) => ({
    query: String(row.query ?? ''),
    answer: String(row.answer ?? ''),
    summary: row.summary === null || row.summary === undefined ? null : String(row.summary),
  }));
}

export async function appendSessionMessage(
  sessionId: string,
  message: StoredMessage
): Promise<void> {
  await ensureSchema();
  const db = getLibsqlClient();

  await db.execute({
    sql: `INSERT INTO web_chat_messages (session_id, query, answer, summary)
          VALUES (?, ?, ?, ?)`,
    args: [sessionId, message.query, message.answer, message.summary],
  });
}

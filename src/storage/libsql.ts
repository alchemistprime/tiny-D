import { createClient, type Client } from '@libsql/client';

let client: Client | null = null;
let schemaReady = false;

export function getLibsqlClient(): Client {
  if (client) return client;

  const url = process.env.LIBSQL_URL;
  const authToken = process.env.LIBSQL_AUTH_TOKEN;

  if (!url) {
    throw new Error('LIBSQL_URL is not set');
  }

  client = createClient({
    url,
    authToken,
  });

  return client;
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const db = getLibsqlClient();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS web_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      query TEXT NOT NULL,
      answer TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_web_chat_messages_session
    ON web_chat_messages(session_id, id)
  `);

  schemaReady = true;
}

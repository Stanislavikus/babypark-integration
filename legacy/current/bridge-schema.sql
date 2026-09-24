CREATE TABLE outgoing_viber (
    message_token TEXT PRIMARY KEY,
    chatwoot_message_id TEXT NOT NULL,
    conversation_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
CREATE TABLE processed_chatwoot (
    message_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
CREATE TABLE processed_viber (
    message_token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
CREATE TABLE sessions (
    viber_user_id TEXT PRIMARY KEY,
    contact_id INTEGER NOT NULL,
    source_id TEXT NOT NULL,
    conversation_id INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

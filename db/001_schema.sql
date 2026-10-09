CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS chat_users (
 id BIGSERIAL PRIMARY KEY, telegram_user_id BIGINT UNIQUE NOT NULL, first_name TEXT, last_name TEXT, username TEXT, display_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS chat_messages (
 id BIGSERIAL PRIMARY KEY, chat_id BIGINT NOT NULL, message_id BIGINT NOT NULL, sender_id BIGINT, sender_name TEXT, username TEXT, message_date TIMESTAMPTZ NOT NULL, message_type TEXT NOT NULL DEFAULT 'text', text TEXT, reply_to_message_id BIGINT, raw_json JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(chat_id,message_id)
);
CREATE TABLE IF NOT EXISTS ai_memories (
 id BIGSERIAL PRIMARY KEY, chat_id BIGINT NOT NULL, memory_type TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, importance INTEGER NOT NULL DEFAULT 3, source_message_id BIGINT, sender_id BIGINT, sender_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ai_conversations (
 id BIGSERIAL PRIMARY KEY, chat_id BIGINT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS knowledge_documents (
 id BIGSERIAL PRIMARY KEY, source_name TEXT NOT NULL, source_type TEXT NOT NULL, source_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS knowledge_chunks (
 id BIGSERIAL PRIMARY KEY, document_id BIGINT REFERENCES knowledge_documents(id) ON DELETE CASCADE, source_name TEXT NOT NULL, source_type TEXT NOT NULL, page INTEGER, chunk_index INTEGER, content TEXT NOT NULL, search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple',coalesce(content,''))) STORED, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ai_memory_state (chat_id BIGINT PRIMARY KEY,last_processed_message_id BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS chat_messages_chat_message_idx ON chat_messages(chat_id,message_id);
CREATE INDEX IF NOT EXISTS chat_messages_text_trgm_idx ON chat_messages USING gin(text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ai_memories_chat_type_idx ON ai_memories(chat_id,memory_type);
CREATE INDEX IF NOT EXISTS ai_memories_chat_updated_idx ON ai_memories(chat_id,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_memories_dedupe_idx ON ai_memories(chat_id,memory_type,title);
CREATE INDEX IF NOT EXISTS knowledge_chunks_search_idx ON knowledge_chunks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS knowledge_chunks_content_trgm_idx ON knowledge_chunks USING gin(content gin_trgm_ops);

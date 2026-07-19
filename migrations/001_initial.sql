CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_folder AS ENUM ('inbox', 'spam', 'trash');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name TEXT,
  role user_role NOT NULL DEFAULT 'member',
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id UUID PRIMARY KEY,
  address TEXT NOT NULL UNIQUE CHECK (address = lower(address)),
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_catch_all BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS only_one_catch_all ON mailboxes (is_catch_all) WHERE is_catch_all;

CREATE TABLE IF NOT EXISTS user_mailboxes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, mailbox_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  internet_message_id TEXT,
  sender_name TEXT,
  sender_address TEXT NOT NULL,
  sender_domain TEXT,
  recipient_address TEXT NOT NULL,
  recipients JSONB NOT NULL DEFAULT '[]',
  cc JSONB NOT NULL DEFAULT '[]',
  reply_to TEXT,
  subject TEXT,
  preview TEXT NOT NULL DEFAULT '',
  text_object_key TEXT,
  html_object_key TEXT,
  raw_object_key TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  is_starred BOOLEAN NOT NULL DEFAULT FALSE,
  folder message_folder NOT NULL DEFAULT 'inbox',
  deleted_at TIMESTAMPTZ,
  size_bytes BIGINT NOT NULL,
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  warning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mailbox_id, internet_message_id)
);
CREATE INDEX IF NOT EXISTS messages_mailbox_received ON messages(mailbox_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_mailbox_unread ON messages(mailbox_id, is_read, received_at DESC);
CREATE INDEX IF NOT EXISTS messages_mailbox_starred ON messages(mailbox_id, is_starred, received_at DESC);
CREATE INDEX IF NOT EXISTS messages_folder_received ON messages(folder, received_at DESC);
CREATE INDEX IF NOT EXISTS messages_search_subject ON messages USING gin (subject gin_trgm_ops);
CREATE INDEX IF NOT EXISTS messages_search_sender ON messages USING gin (sender_address gin_trgm_ops);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_id TEXT,
  disposition TEXT,
  size_bytes BIGINT NOT NULL,
  object_key TEXT NOT NULL,
  is_suspicious BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments(message_id);

CREATE TABLE IF NOT EXISTS sender_rules (
  id UUID PRIMARY KEY,
  value TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('allow', 'block')),
  match_type TEXT NOT NULL CHECK (match_type IN ('address', 'domain')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(value, rule_type, match_type)
);

CREATE TABLE IF NOT EXISTS processing_failures (
  id UUID PRIMARY KEY,
  envelope_sender TEXT,
  envelope_recipient TEXT,
  error_code TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


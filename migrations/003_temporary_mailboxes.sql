ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS is_temporary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS access_token_hash TEXT;

CREATE INDEX IF NOT EXISTS temporary_mailboxes_expiry
  ON mailboxes (expires_at)
  WHERE is_temporary = TRUE;

ALTER TABLE mailboxes DROP CONSTRAINT IF EXISTS temporary_mailbox_metadata;
ALTER TABLE mailboxes ADD CONSTRAINT temporary_mailbox_metadata CHECK (
  (is_temporary = FALSE AND expires_at IS NULL AND access_token_hash IS NULL)
  OR
  (is_temporary = TRUE AND access_token_hash IS NOT NULL AND is_catch_all = FALSE)
);

ALTER TYPE message_folder ADD VALUE IF NOT EXISTS 'sent';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS previous_folder message_folder;

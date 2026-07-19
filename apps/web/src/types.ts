import type { Folder, SessionUser } from "@aurens/shared";

export type { Folder, SessionUser };

export interface Mailbox {
  id: string;
  address: string;
  display_name: string | null;
  is_active: boolean;
  is_catch_all: boolean;
  unread_count: number;
}

export interface MessageSummary {
  id: string;
  sender_name: string | null;
  sender_address: string;
  recipient_address: string;
  subject: string | null;
  preview: string;
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  folder: Folder;
  has_attachments: boolean;
  warning: string | null;
  mailbox_id: string;
  mailbox_address: string;
  mailbox_display_name: string | null;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  content_id: string | null;
  disposition: string | null;
  size_bytes: number;
  is_suspicious: boolean;
}

export interface MessageDetail extends MessageSummary {
  reply_to: string | null;
  recipients: string[];
  cc: string[];
  text: string;
  html: string | null;
  attachments: Attachment[];
}


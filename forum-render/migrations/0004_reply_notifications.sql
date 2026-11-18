ALTER TABLE replies ADD COLUMN reply_to_id text REFERENCES replies(id);
CREATE TABLE notifications (
  id text PRIMARY KEY NOT NULL,
  recipient_id text NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  kind text NOT NULL,
  post_id text NOT NULL REFERENCES posts(id),
  reply_id text NOT NULL REFERENCES replies(id),
  created integer NOT NULL,
  read_at integer,
  UNIQUE(recipient_id,reply_id)
);
CREATE INDEX notification_recipient ON notifications(recipient_id,created);

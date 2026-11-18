ALTER TABLE posts ADD COLUMN moderated integer NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN locked integer NOT NULL DEFAULT 0;
ALTER TABLE replies ADD COLUMN moderated integer NOT NULL DEFAULT 0;
CREATE TABLE user_roles (
 user_id text PRIMARY KEY NOT NULL REFERENCES profiles(id),
 role text NOT NULL CHECK(role IN ('owner','admin','moderator')),
 created integer NOT NULL
);
CREATE UNIQUE INDEX one_site_owner ON user_roles(role) WHERE role='owner';
CREATE TABLE member_controls (
 user_id text PRIMARY KEY NOT NULL REFERENCES profiles(id),
 status text NOT NULL CHECK(status IN ('muted','banned')),
 reason text NOT NULL,
 expires integer,
 updated integer NOT NULL
);
CREATE TABLE forum_boards (
 id text PRIMARY KEY NOT NULL,
 name text NOT NULL UNIQUE,
 group_name text NOT NULL,
 sort_order integer NOT NULL,
 visible integer NOT NULL DEFAULT 1,
 posting_enabled integer NOT NULL DEFAULT 1,
 created integer NOT NULL
);
CREATE TABLE board_aliases (
 old_name text PRIMARY KEY NOT NULL,
 board_id text NOT NULL REFERENCES forum_boards(id)
);
CREATE TABLE site_settings (
 key text PRIMARY KEY NOT NULL,
 value text NOT NULL,
 updated integer NOT NULL
);
CREATE TABLE reports (
 id text PRIMARY KEY NOT NULL,
 reporter_id text NOT NULL REFERENCES profiles(id),
 target_kind text NOT NULL CHECK(target_kind IN ('post','reply')),
 target_id text NOT NULL,
 post_id text NOT NULL REFERENCES posts(id),
 reason text NOT NULL,
 status text NOT NULL DEFAULT 'open',
 resolution text,
 handled_by text,
 created integer NOT NULL,
 updated integer NOT NULL,
 UNIQUE(reporter_id,target_kind,target_id)
);
CREATE INDEX report_status ON reports(status,created);
CREATE TABLE admin_audit (
 id text PRIMARY KEY NOT NULL,
 actor_id text NOT NULL,
 actor_name text NOT NULL,
 action text NOT NULL,
 target_id text,
 details text NOT NULL,
 created integer NOT NULL
);
CREATE INDEX audit_created ON admin_audit(created);

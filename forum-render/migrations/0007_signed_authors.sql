ALTER TABLE profiles ADD COLUMN signed_author integer NOT NULL DEFAULT 0 CHECK(signed_author IN (0,1));
ALTER TABLE forum_boards ADD COLUMN signed_author_only integer NOT NULL DEFAULT 0 CHECK(signed_author_only IN (0,1));

INSERT INTO forum_boards(id,name,group_name,sort_order,visible,posting_enabled,created,signed_author_only)
VALUES ('signed-author-board','签约作者专区','文艺与远方',65,1,1,0,1)
ON CONFLICT DO NOTHING;

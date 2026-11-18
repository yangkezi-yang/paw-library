CREATE TABLE profile_avatars (
  user_id text PRIMARY KEY NOT NULL,
  image_base64 text NOT NULL,
  content_type text NOT NULL,
  version text NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(id)
);
UPDATE posts SET board='编辑那点事' WHERE board='生活那点事';

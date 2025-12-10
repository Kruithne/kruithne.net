CREATE TABLE post_likes (
	post_slug VARCHAR(255) NOT NULL,
	visitor_id CHAR(32) NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (post_slug, visitor_id),
	INDEX idx_post_slug (post_slug)
);

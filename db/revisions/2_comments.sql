CREATE TABLE comments (
	id INT AUTO_INCREMENT PRIMARY KEY,
	post_slug VARCHAR(255) NOT NULL,
	session_token CHAR(64) NOT NULL,
	content TEXT NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	INDEX idx_post_slug (post_slug),
	FOREIGN KEY (session_token) REFERENCES comment_sessions(token)
);

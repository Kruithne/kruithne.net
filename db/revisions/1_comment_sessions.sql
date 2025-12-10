CREATE TABLE comment_sessions (
	token CHAR(64) PRIMARY KEY,
	email VARCHAR(254) NOT NULL,
	display_name VARCHAR(100) NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	verified_at TIMESTAMP NULL,
	expires_at TIMESTAMP NOT NULL,
	INDEX idx_email (email)
);

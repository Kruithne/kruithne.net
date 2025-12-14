-- Add unique token to post_subscriptions for VERP bounce tracking and secure unsubscribe
ALTER TABLE post_subscriptions ADD COLUMN token VARCHAR(8) UNIQUE;

-- Generate tokens for existing subscriptions (MySQL syntax)
UPDATE post_subscriptions SET token = LOWER(SUBSTR(MD5(RAND()), 1, 8)) WHERE token IS NULL;

-- Make token required for new subscriptions (MySQL syntax)
ALTER TABLE post_subscriptions MODIFY COLUMN token VARCHAR(8) NOT NULL UNIQUE;

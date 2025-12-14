-- Add unique token to post_subscriptions for VERP bounce tracking and secure unsubscribe
ALTER TABLE post_subscriptions ADD COLUMN token VARCHAR(8) UNIQUE;

-- Generate tokens for existing subscriptions
UPDATE post_subscriptions SET token = LOWER(SUBSTR(MD5(RANDOM()::text), 1, 8)) WHERE token IS NULL;

-- Make token required for new subscriptions
ALTER TABLE post_subscriptions ALTER COLUMN token SET NOT NULL;

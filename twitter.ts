import { log_create_logger } from 'spooder';
import { createHmac, randomBytes } from 'crypto';

const log = log_create_logger('twitter', '#1DA1F2ff');

const TWITTER_API_V2 = 'https://api.x.com/2';
const TWITTER_UPLOAD_API = 'https://upload.twitter.com/1.1';

type TwitterPostConfig = {
	text: string;
	image_path?: string;
	image_alt?: string;
};

type TwitterCredentials = {
	api_key: string;
	api_secret: string;
	access_token: string;
	access_secret: string;
};

function get_credentials(): TwitterCredentials | null {
	const api_key = process.env.TWITTER_API_KEY;
	const api_secret = process.env.TWITTER_API_SECRET;
	const access_token = process.env.TWITTER_ACCESS_TOKEN;
	const access_secret = process.env.TWITTER_ACCESS_SECRET;

	if (!api_key || !api_secret || !access_token || !access_secret)
		return null;

	return { api_key, api_secret, access_token, access_secret };
}

function percent_encode(str: string): string {
	return encodeURIComponent(str)
		.replace(/!/g, '%21')
		.replace(/\*/g, '%2A')
		.replace(/'/g, '%27')
		.replace(/\(/g, '%28')
		.replace(/\)/g, '%29');
}

function generate_nonce(): string {
	return randomBytes(32).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
}

function generate_timestamp(): string {
	return Math.floor(Date.now() / 1000).toString();
}

function create_signature_base_string(
	method: string,
	url: string,
	params: Record<string, string>
): string {
	// sort parameters alphabetically by key
	const sorted_keys = Object.keys(params).sort();
	const param_string = sorted_keys
		.map(key => `${percent_encode(key)}=${percent_encode(params[key])}`)
		.join('&');

	return `${method.toUpperCase()}&${percent_encode(url)}&${percent_encode(param_string)}`;
}

function create_signature(
	base_string: string,
	credentials: TwitterCredentials
): string {
	const signing_key = `${percent_encode(credentials.api_secret)}&${percent_encode(credentials.access_secret)}`;
	const hmac = createHmac('sha1', signing_key);
	hmac.update(base_string);
	return hmac.digest('base64');
}

function create_oauth_header(
	method: string,
	url: string,
	credentials: TwitterCredentials,
	extra_params: Record<string, string> = {}
): string {
	const oauth_params: Record<string, string> = {
		oauth_consumer_key: credentials.api_key,
		oauth_nonce: generate_nonce(),
		oauth_signature_method: 'HMAC-SHA1',
		oauth_timestamp: generate_timestamp(),
		oauth_token: credentials.access_token,
		oauth_version: '1.0'
	};

	// combine oauth params with any extra params for signature
	const all_params = { ...oauth_params, ...extra_params };
	const base_string = create_signature_base_string(method, url, all_params);
	const signature = create_signature(base_string, credentials);

	oauth_params.oauth_signature = signature;

	// build authorization header
	const header_params = Object.keys(oauth_params)
		.sort()
		.map(key => `${percent_encode(key)}="${percent_encode(oauth_params[key])}"`)
		.join(', ');

	return `OAuth ${header_params}`;
}

async function upload_media(credentials: TwitterCredentials, image_path: string): Promise<string> {
	const file = Bun.file(image_path);
	const data = await file.arrayBuffer();
	const base64_data = Buffer.from(data).toString('base64');

	const url = `${TWITTER_UPLOAD_API}/media/upload.json`;

	// for multipart/form-data with oauth 1.0a, we need to sign without the body params
	// but include them in the actual request
	const auth_header = create_oauth_header('POST', url, credentials);

	const form_data = new FormData();
	form_data.append('media_data', base64_data);

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Authorization': auth_header
		},
		body: form_data
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`failed to upload media: ${response.status} ${error}`);
	}

	const result = await response.json() as { media_id_string: string };
	return result.media_id_string;
}

async function create_tweet(
	credentials: TwitterCredentials,
	text: string,
	media_id?: string
): Promise<string> {
	const url = `${TWITTER_API_V2}/tweets`;

	const body: Record<string, unknown> = { text };

	if (media_id) {
		body.media = { media_ids: [media_id] };
	}

	const auth_header = create_oauth_header('POST', url, credentials);

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Authorization': auth_header,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`failed to create tweet: ${response.status} ${error}`);
	}

	const result = await response.json() as { data: { id: string; text: string } };
	return result.data.id;
}

export async function twitter_post(config: TwitterPostConfig): Promise<string | null> {
	const credentials = get_credentials();
	if (!credentials) {
		log`{skipping post - credentials not configured}`;
		return null;
	}

	try {
		let media_id: string | undefined;

		if (config.image_path) {
			log`{uploading media from ${config.image_path}}`;
			media_id = await upload_media(credentials, config.image_path);
			log`{media uploaded: ${media_id}}`;
		}

		const tweet_id = await create_tweet(credentials, config.text, media_id);
		log`{posted successfully} {https://x.com/i/status/${tweet_id}}`;
		return tweet_id;
	} catch (err) {
		log`{failed to post} {${err instanceof Error ? err.message : String(err)}}`;
		throw err;
	}
}

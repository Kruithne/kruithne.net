import { log_create_logger } from 'spooder';

const log = log_create_logger('bluesky', '#0085ffff');

const BLUESKY_API = 'https://bsky.social/xrpc';

type BlueskySession = {
	access_jwt: string;
	refresh_jwt: string;
	did: string;
	handle: string;
	expires_at: number;
};

type BlueskyPostConfig = {
	text: string;
	image_path?: string;
	image_alt?: string;
	link?: string;
};

type BlobRef = {
	$type: 'blob';
	ref: { $link: string };
	mimeType: string;
	size: number;
};

let cached_session: BlueskySession | null = null;

function get_credentials(): { identifier: string; password: string } | null {
	const identifier = process.env.BLUESKY_IDENTIFIER;
	const password = process.env.BLUESKY_APP_PASSWORD;

	if (!identifier || !password)
		return null;

	return { identifier, password };
}

async function create_session(): Promise<BlueskySession> {
	const credentials = get_credentials();
	if (!credentials)
		throw new Error('BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD must be configured');

	const response = await fetch(`${BLUESKY_API}/com.atproto.server.createSession`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			identifier: credentials.identifier,
			password: credentials.password
		})
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`failed to create bluesky session: ${response.status} ${error}`);
	}

	const data = await response.json() as {
		accessJwt: string;
		refreshJwt: string;
		did: string;
		handle: string;
	};

	// jwt expires in ~2 hours, refresh before that
	const expires_at = Date.now() + (90 * 60 * 1000); // 90 minutes

	return {
		access_jwt: data.accessJwt,
		refresh_jwt: data.refreshJwt,
		did: data.did,
		handle: data.handle,
		expires_at
	};
}

async function refresh_session(session: BlueskySession): Promise<BlueskySession> {
	const response = await fetch(`${BLUESKY_API}/com.atproto.server.refreshSession`, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${session.refresh_jwt}`
		}
	});

	if (!response.ok) {
		// refresh failed, create new session
		return await create_session();
	}

	const data = await response.json() as {
		accessJwt: string;
		refreshJwt: string;
		did: string;
		handle: string;
	};

	const expires_at = Date.now() + (90 * 60 * 1000);

	return {
		access_jwt: data.accessJwt,
		refresh_jwt: data.refreshJwt,
		did: data.did,
		handle: data.handle,
		expires_at
	};
}

async function get_session(): Promise<BlueskySession> {
	if (cached_session) {
		// refresh if expired or about to expire
		if (Date.now() >= cached_session.expires_at) {
			cached_session = await refresh_session(cached_session);
		}
		return cached_session;
	}

	cached_session = await create_session();
	return cached_session;
}

function get_mime_type(file_path: string): string {
	const ext = file_path.toLowerCase().split('.').pop();
	switch (ext) {
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'png':
			return 'image/png';
		case 'gif':
			return 'image/gif';
		case 'webp':
			return 'image/webp';
		default:
			return 'image/jpeg';
	}
}

async function upload_blob(session: BlueskySession, image_path: string): Promise<BlobRef> {
	const file = Bun.file(image_path);
	const data = await file.arrayBuffer();
	const mime_type = get_mime_type(image_path);

	// bluesky has a 1mb limit for images
	if (data.byteLength > 1000000)
		throw new Error(`image too large: ${data.byteLength} bytes (max 1000000)`);

	const response = await fetch(`${BLUESKY_API}/com.atproto.repo.uploadBlob`, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${session.access_jwt}`,
			'Content-Type': mime_type
		},
		body: data
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`failed to upload blob: ${response.status} ${error}`);
	}

	const result = await response.json() as { blob: BlobRef };
	return result.blob;
}

function parse_facets(text: string): { index: { byteStart: number; byteEnd: number }; features: object[] }[] {
	const facets: { index: { byteStart: number; byteEnd: number }; features: object[] }[] = [];
	const encoder = new TextEncoder();

	// find urls in text
	const url_regex = /https?:\/\/[^\s\[\]<>"{}|\\^`]+/g;
	let match;

	while ((match = url_regex.exec(text)) !== null) {
		const url = match[0];
		const start = match.index;

		// calculate byte positions (needed for unicode)
		const before_text = text.slice(0, start);
		const byte_start = encoder.encode(before_text).length;
		const byte_end = byte_start + encoder.encode(url).length;

		facets.push({
			index: { byteStart: byte_start, byteEnd: byte_end },
			features: [{
				$type: 'app.bsky.richtext.facet#link',
				uri: url
			}]
		});
	}

	return facets;
}

async function create_post(session: BlueskySession, config: BlueskyPostConfig): Promise<string> {
	const record: Record<string, unknown> = {
		$type: 'app.bsky.feed.post',
		text: config.text,
		createdAt: new Date().toISOString()
	};

	// add link facets if present
	const facets = parse_facets(config.text);
	if (facets.length > 0)
		record.facets = facets;

	// add image embed if provided
	if (config.image_path) {
		const blob = await upload_blob(session, config.image_path);
		record.embed = {
			$type: 'app.bsky.embed.images',
			images: [{
				image: blob,
				alt: config.image_alt ?? ''
			}]
		};
	}

	const response = await fetch(`${BLUESKY_API}/com.atproto.repo.createRecord`, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${session.access_jwt}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			repo: session.did,
			collection: 'app.bsky.feed.post',
			record
		})
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`failed to create post: ${response.status} ${error}`);
	}

	const result = await response.json() as { uri: string; cid: string };
	return result.uri;
}

export async function bluesky_post(config: BlueskyPostConfig): Promise<string | null> {
	const credentials = get_credentials();
	if (!credentials) {
		log`{skipping post - credentials not configured}`;
		return null;
	}

	try {
		const session = await get_session();
		const uri = await create_post(session, config);
		log`{posted successfully} {${uri}}`;
		return uri;
	} catch (err) {
		log`{failed to post} {${err instanceof Error ? err.message : String(err)}}`;
		throw err;
	}
}

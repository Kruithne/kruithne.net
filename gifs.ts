import * as spooder from 'spooder';

const CDN_BUCKET_URL = 'https://cdn.rubberducksolutions.dev/data/gifs';

// <id>[.<ext>] — the CDN resolves the extension itself and sets the content type
const FILE_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}(\.[a-z0-9]{1,8})?$/;

const CACHE_CONTROL = 'public, max-age=86400';
const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

/**
 * Proxies the public gifs CDN bucket at /gifs/<id>.<ext>.
 *
 * Proxied rather than redirected so the shared kruithne.net URL is the one
 * embed consumers see, and so the CDN host stays swappable.
 */
export function init_gifs(server: ReturnType<typeof spooder.http_serve>) {
	server.route('/gifs/:file', async (req, url) => {
		const file = url.searchParams.get('file');

		if (file === null || !FILE_PATTERN.test(file))
			return 400;

		const headers: Record<string, string> = {};
		const range = req.headers.get('range');
		if (range !== null)
			headers.range = range;

		const res = await fetch(`${CDN_BUCKET_URL}/${file}`, { headers });

		if (res.status === 404)
			return 404;

		if (!res.ok && res.status !== 206) {
			spooder.caution('gifs: CDN fetch failed', { file, status: res.status });
			return 502;
		}

		const out = new Headers({ 'Cache-Control': CACHE_CONTROL });

		for (const header of PASSTHROUGH_HEADERS) {
			const value = res.headers.get(header);
			if (value !== null)
				out.set(header, value);
		}

		// buffered rather than streamed so Content-Length survives; gifs are
		// small and embed consumers are happier with a known length
		const body = await res.arrayBuffer();
		out.set('Content-Length', String(body.byteLength));

		return new Response(req.method === 'HEAD' ? null : body, { status: res.status, headers: out });
	}, ['GET', 'HEAD']);
}

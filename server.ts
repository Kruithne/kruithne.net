import * as spooder from 'spooder';
import { init as init_wow_export } from './wow.export/module';
import path from 'node:path';
import fs from 'node:fs/promises';

// region constants
const PAGE_DIR = './html/pages';
const PAGE_DEFAULT_TITLE = 'kruithne.net';
const PAGE_INDEX = '/index';

const CACHE_TTL = 24 * 60 * 60 * 1000; // 5 hours
const CACHE_MAX_SIZE = 5 * 1024 * 1024; // 5 mb
// endregion

// region bootstrap
const server = spooder.http_serve(Number(process.env.SERVER_PORT), process.env.SERVER_LISTEN_HOST);
//await init_wow_export(server);

const global_sub_table = {
	cache_bust: spooder.cache_bust,
	image: (path: string) => `<div class="image"><img src="/${spooder.cache_bust(path)}"></div>`
};

const cache = spooder.cache_http({
	ttl: CACHE_TTL,
	max_size: CACHE_MAX_SIZE,
	use_canary_reporting: true,
	use_etags: true,
	enabled: process.env.SPOODER_ENV !== 'dev'
});

async function template_page(content: string) {
	const template = await Bun.file('./html/template.html').text();
	return await spooder.parse_template(template, { content }, false);
}

function error_page(status_code: number) {
	return async function() {
		const sub_table = Object.assign({
			error_code: status_code.toString(),
			error_text: spooder.HTTP_STATUS_TEXT[status_code] as string
		}, global_sub_table);

		const error_content = await Bun.file('./html/error.html').text();
		return await spooder.parse_template(await template_page(error_content), sub_table, true);
	}
}

await (async () => {
	const pages = await fs.readdir(PAGE_DIR);
	for (const page of pages) {
		if (!page.endsWith('.html'))
			continue;

		const page_path = path.join(PAGE_DIR, page);

		let slug = '/' + path.basename(page, path.extname(page));
		if (slug === PAGE_INDEX)
			slug = '/';

		server.route(slug, (req, url) => {
			return cache.request(req, slug, async () => {
				const content = await Bun.file(page_path).text();
				const h1_match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
				const page_title = h1_match?.[1] ?? PAGE_DEFAULT_TITLE;

				return await spooder.parse_template(
					await template_page(content),
					{
						page_title,
						...global_sub_table
					},
					true
				);
			});
		});
	}
})();

server.error((err, req) => {
	spooder.caution(err?.message ?? err);
	
	return cache.request(
		req,
		'error_500',
		error_page(spooder.HTTP_STATUS_CODE.InternalServerError_500),
		spooder.HTTP_STATUS_CODE.InternalServerError_500
	);
});

server.default((req, status_code) => cache.request(
	req,
	`error_${status_code}`,
	error_page(status_code),
	status_code
));

const STATIC_SUB_EXT = ['.css', '.js'];
server.dir('/static', './static', async (file_path, file, stat, request) => {
	// ignore hidden files by default, return 404 to prevent file sniffing
	if (path.basename(file_path).startsWith('.'))
		return spooder.HTTP_STATUS_CODE.NotFound_404;
	
	if (stat.isDirectory())
		return spooder.HTTP_STATUS_CODE.Unauthorized_401;

	const ext_idx = file_path.lastIndexOf('.');
	if (ext_idx > -1) {
		const ext = file_path.slice(ext_idx);

		if (STATIC_SUB_EXT.includes(ext)) {
			const content = await spooder.parse_template(await file.text(), global_sub_table, false);
			return new Response(content, { headers: { 'Content-Type': file.type }});
		}
	}
	
	return spooder.http_apply_range(file, request);
});
// endregion

// region legacy
server.route('/home/files/patreon/*', (req, url) => {
	const path_suffix = url.pathname.slice('/home/files/patreon/'.length);
	return Response.redirect(`https://patreon.kruithne.net/files/${path_suffix}`, 301);
});
// endregion

// region webhooks
if (typeof process.env.GH_WEBHOOK_SECRET === 'string') {
	server.webhook(process.env.GH_WEBHOOK_SECRET, '/internal/hook_source_change', () => {
		setImmediate(async () => {
			await server.stop(false);
			process.exit(0);
		});
		return 200;
	});
} else {
	spooder.caution('GH_WEBHOOK_SECRET environment variable not configured');
}
// endregion
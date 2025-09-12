import { http_serve, caution, cache_bust, cache_http, parse_template, http_apply_range, HTTP_STATUS_TEXT, HTTP_STATUS_CODE } from 'spooder';
import { init as init_wow_export } from './wow.export/module';
import path from 'node:path';
import fs from 'node:fs';

// region typing
type BunFile = ReturnType<typeof Bun.file>;
// endregion

// region generic
function is_bun_file(obj: any): obj is BunFile {
	return obj.constructor === Blob;
}

async function resolve_bootstrap_content(content: string | BunFile): Promise<string> {
	if (is_bun_file(content))
		return await content.text();

	return content;
}
// endregion

// region bootstrap
const server = http_serve(Number(process.env.SERVER_PORT), process.env.SERVER_LISTEN_HOST);

const global_sub_table = { cache_bust };
const cache = cache_http({
	ttl: 24 * 60 * 60 * 1000, // 5 hours
	max_size: 5 * 1024 * 1024, // 5 MB
	use_canary_reporting: true,
	use_etags: true,
	enabled: process.env.SPOODER_ENV !== 'dev'
});

const error_base_content = await resolve_bootstrap_content(Bun.file('./html/error.html'));
const error_page = (status_code: number) => async () => {
	const sub_table = Object.assign({
		error_code: status_code.toString(),
		error_text: HTTP_STATUS_TEXT[status_code] as string
	}, global_sub_table);

	return await parse_template(error_base_content, sub_table, true);
};

server.error((err, req) => {
	caution(err?.message ?? err);
	
	return cache.request(
		req,
		'error_500',
		error_page(HTTP_STATUS_CODE.InternalServerError_500),
		HTTP_STATUS_CODE.InternalServerError_500
	);
});

server.default((req, status_code) => cache.request(
	req,
	`error_${status_code}`,
	error_page(status_code),
	status_code
));

server.route('/', (req, url) => {
	return cache.request(req, '/', async () => {
		return await parse_template(
			await resolve_bootstrap_content(Bun.file('./html/index.html')),
			global_sub_table,
			false
		);
	});
});

const STATIC_SUB_EXT = ['.css', '.js'];
server.dir('/static', './static', async (file_path, file, stat, request) => {
	// ignore hidden files by default, return 404 to prevent file sniffing
	if (path.basename(file_path).startsWith('.'))
		return HTTP_STATUS_CODE.NotFound_404;
	
	if (stat.isDirectory())
		return HTTP_STATUS_CODE.Unauthorized_401;

	await Bun.sleep(400); // todo: remove me

	const ext_idx = file_path.lastIndexOf('.');
	if (ext_idx > -1) {
		const ext = file_path.slice(ext_idx);

		if (STATIC_SUB_EXT.includes(ext)) {
			const content = await parse_template(await file.text(), global_sub_table, false);
			return new Response(content, { headers: { 'Content-Type': file.type }});
		}
	}
	
	return http_apply_range(file, request);
});
init_wow_export(server);
// endregion

// region legacy
server.dir('/home', './home', async (file_path, file, stat, request) => {
	if (path.basename(file_path).startsWith('.'))
		return 404;

	if (stat.isDirectory()) {
		try {
			const entries = await fs.promises.readdir(file_path);
			const filtered_entries = entries.filter(entry => !entry.startsWith('.'));
			
			const request_path = new URL(request.url).pathname;
			const links = filtered_entries.map(entry => {
				return `<a href="${request_path}/${entry}">${entry}</a>`;
			}).join('<br>\n');
			
			const html = `<!DOCTYPE html><html><head><title>Directory listing</title></head><body><h1>Directory listing</h1>${links}</body></html>`;
			
			return new Response(html, {
				status: 200,
				headers: { 'Content-Type': 'text/html' }
			});
		} catch (err) {
			return 500;
		}
	}

	return file;
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
	caution('GH_WEBHOOK_SECRET environment variable not configured');
}
// endregion
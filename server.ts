import { http_serve, caution, HTTP_STATUS_TEXT } from 'spooder';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ColorInput } from 'bun';
import { init as init_wow_export } from './wow.export/module';

const server = http_serve(Number(process.env.SERVER_PORT), process.env.SERVER_LISTEN_HOST);

const ANSI_RESET = '\x1b[0m';
function log(message: string, color: ColorInput = 'purple'): void {
	const ansi = Bun.color(color, 'ansi');
	process.stdout.write(`[{info}] > ${message}\n`.replace(/\{([^}]+)\}/g, `${ansi}$1${ANSI_RESET}`));
}

// let index: string|null = null;
// let index_hash: string|null = null;

// server.route('/', async (req, _url) => {
// 	if (index === null) {
// 		index = await Bun.file('./html/index.html').text();
// 		index_hash = crypto.createHash('sha256').update(index).digest('hex');
// 	}
	
// 	const headers = {
// 		'Content-Type': 'text/html',
// 		'Access-Control-Allow-Origin':  '*',
// 		'ETag': index_hash as string
// 	} as Record<string, string>;
	
// 	if (req.headers.get('If-None-Match') === index_hash)
// 		return new Response(null, { status: 304, headers }); // Not Modified
	
// 	return new Response(index, { status: 200, headers });
// });

server.route('/', () => {
	const file = Bun.file('./html/index.html');
	return new Response(file, { status: 200 });
});

server.dir('/static', './static');
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

init_wow_export(server);

async function default_handler(status_code: number): Promise<Response> {
	return new Response(HTTP_STATUS_TEXT[status_code], { status: status_code });
}

// Unhandled exceptions and rejections from handlers.
server.error((err: Error) => {
	caution(err?.message ?? err);
	return default_handler(500);
});

// Unhandled response codes.
server.default((_req, status_code) => default_handler(status_code));

// Automatic update webhook
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
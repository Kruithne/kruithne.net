import { http_serve, caution, HTTP_STATUS_TEXT } from 'spooder';
import path from 'node:path';
import fs from 'node:fs';
import { init as init_wow_export } from './wow.export/module';

const server = http_serve(Number(process.env.SERVER_PORT), process.env.SERVER_LISTEN_HOST);

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
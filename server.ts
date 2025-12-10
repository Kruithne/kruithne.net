import * as spooder from 'spooder';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { smtp_send } from './smtp';
import { db } from './db';

const execAsync = promisify(exec);

// region constants
const PAGE_DIR = './html/pages';
const PAGE_DEFAULT_TITLE = 'kruithne.net';
const PAGE_INDEX = '/index';

const CACHE_TTL = 24 * 60 * 60 * 1000; // 5 hours
const CACHE_MAX_SIZE = 5 * 1024 * 1024; // 5 mb
// endregion

// region thumbnail queue
const thumb_queue: Map<string, { cmd: string, thumb_path: string }> = new Map();
const thumb_processing: Set<string> = new Set();
let request_has_pending_thumbs = false;

async function process_thumb_queue() {
	for (const [key, job] of thumb_queue) {
		if (thumb_processing.has(key))
			continue;

		thumb_processing.add(key);
		thumb_queue.delete(key);

		try {
			const thumb_dir = path.dirname(job.thumb_path);
			await fs.mkdir(thumb_dir, { recursive: true });
			await execAsync(job.cmd);
		} catch (err) {
			spooder.caution(`failed to generate thumbnail`, { key, err });
		} finally {
			thumb_processing.delete(key);
		}

		// process next item
		setImmediate(process_thumb_queue);
		return;
	}
}

function queue_thumb(key: string, cmd: string, thumb_path: string) {
	if (!thumb_queue.has(key) && !thumb_processing.has(key)) {
		thumb_queue.set(key, { cmd, thumb_path });
		setImmediate(process_thumb_queue);
	}
	request_has_pending_thumbs = true;
}

function is_thumb_ready(key: string): boolean {
	return !thumb_queue.has(key) && !thumb_processing.has(key);
}
// endregion

// region bootstrap
const server = spooder.http_serve(Number(process.env.SERVER_PORT), process.env.SERVER_LISTEN_HOST);

if (process.env.SPOODER_ENV !== 'dev') {
	const { init: init_wow_export } = await import('./wow.export/module');
	await init_wow_export(server);
}

type ThumbResult = {
	thumb_src: string | null;
	full_src: string;
	popout: boolean;
	title: string | null;
	pending_key: string | null;
	width: number;
	height: number | null;
};

async function get_thumb(input: string): Promise<ThumbResult> {
	// "static/images/test/blah.png?width=530&popout" using URL query params
	// Optional: crop=298 to crop to height 298, cropy=50 to start crop 50px from top
	const [image_path, query_string] = input.split('?');
	const params = new URLSearchParams(query_string);

	const width = parseInt(params.get('width') ?? '', 10);
	const crop = parseInt(params.get('crop') ?? '', 10);
	const cropy = parseInt(params.get('cropy') ?? '0', 10);
	const popout = params.has('popout');
	const title = params.get('title');

	if (!width || isNaN(width))
		throw new Error(`Invalid thumb width in: ${input}`);

	const relative_path = image_path.replace(/^static\/images\//, ''); // test/blah.png
	const ext_idx = relative_path.lastIndexOf('.');
	const path_without_ext = relative_path.substring(0, ext_idx); // test/blah

	// Include crop params in thumb filename if cropping
	const crop_suffix = crop && !isNaN(crop) ? `_c${crop}${cropy ? `y${cropy}` : ''}` : '';
	const thumb_path = `static/images/thumbs/${path_without_ext}_${width}${crop_suffix}.webp`;

	// get the hash from the ORIGINAL image (not the thumb)
	const hash_table = spooder.cache_bust_get_hash_table();
	const original_hash = hash_table[image_path] ?? '';

	const base_result = {
		full_src: `${image_path}?v=${original_hash}`,
		popout,
		title,
		width,
		height: crop && !isNaN(crop) ? crop : null
	};

	let thumb_exists = false;
	try {
		await fs.access(thumb_path);
		thumb_exists = true;
	} catch {
		// thumb doesn't exist, queue it
		let vf_filter = `scale=${width}:-1`;
		if (crop && !isNaN(crop))
			vf_filter += `,crop=${width}:${crop}:0:${cropy}`;

		const cmd = `ffmpeg -i "${image_path}" -vf "${vf_filter}" -lossless 1 -y "${thumb_path}"`;
		queue_thumb(thumb_path, cmd, thumb_path);
	}

	if (thumb_exists) {
		return {
			...base_result,
			thumb_src: `${thumb_path}?v=${original_hash}`,
			pending_key: null
		};
	}

	// return placeholder result
	return {
		...base_result,
		thumb_src: null,
		pending_key: thumb_path
	};
}

const global_sub_table = {
	cache_bust: spooder.cache_bust,
	image: (img_path: string) => `<div class="image"><img src="/${spooder.cache_bust(img_path)}"></div>`,
	thumb: async (input: string) => {
		const { thumb_src, full_src, popout, title, pending_key, width, height } = await get_thumb(input);
		const title_attr = title ? ` title="${title}"` : '';
		const title_data = title ? ` data-title="${title}"` : '';

		if (pending_key) {
			// thumbnail is being generated, return placeholder
			const style = `width:${width}px;${height ? `height:${height}px;` : `aspect-ratio:16/9;`}`;
			const pending_data = ` data-pending-thumb="${pending_key}" data-thumb-full-src="/${full_src}"`;
			if (popout)
				return `<div class="image image-popout image-pending cursor-pointer"${title_data}${pending_data} style="${style}"></div>`;
			return `<div class="image image-pending"${pending_data} style="${style}"></div>`;
		}

		if (popout)
			return `<div class="image image-popout cursor-pointer" data-full-src="/${full_src}"${title_data}><img src="/${thumb_src}"${title_attr}></div>`;
		return `<div class="image"><img src="/${thumb_src}"${title_attr}></div>`;
	},
	svg: async (svg_path: string) => {
		const content = await Bun.file(svg_path).text();
		// Strip XML declaration if present
		return content.replace(/<\?xml[^?]*\?>\s*/i, '');
	}
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

// region devlog posts
type PostMeta = {
	slug: string;
	title: string;
	date: string;
	date_sort: number;
};

const devlog_posts: PostMeta[] = [];

async function load_devlog_posts() {
	const posts_dir = path.join(PAGE_DIR, 'posts');
	const files = await fs.readdir(posts_dir);

	for (const file of files) {
		if (!file.endsWith('.html'))
			continue;

		const file_path = path.join(posts_dir, file);

		// read first 500 bytes, should be enough to get title and date
		const handle = await fs.open(file_path, 'r');
		const buffer = Buffer.alloc(500);
		await handle.read(buffer, 0, 500, 0);
		await handle.close();

		const content = buffer.toString('utf-8');
		const title_match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
		const date_match = content.match(/<time[^>]*datetime="([^"]+)"[^>]*>([^<]+)<\/time>/i);

		if (!title_match || !date_match)
			continue;

		devlog_posts.push({
			slug: '/posts/' + path.basename(file, '.html'),
			title: title_match[1],
			date: date_match[2],
			date_sort: new Date(date_match[1]).getTime()
		});
	}

	// Sort by date, newest first
	devlog_posts.sort((a, b) => b.date_sort - a.date_sort);
}

await load_devlog_posts();

function generate_post_list(): string {
	let html = '';
	let current_year = '';

	for (const post of devlog_posts) {
		const year = new Date(post.date_sort).getFullYear().toString();

		if (year !== current_year) {
			if (current_year !== '')
				html += '</ul>\n<hr>\n';

			html += `<h2>${year}</h2>\n<ul class="post-list">\n`;
			current_year = year;
		}

		html += `<li><a href="${post.slug}">${post.title}<time>${post.date}</time></a></li>\n`;
	}

	if (current_year !== '')
		html += '</ul>';

	return html;
}

function generate_post_nav(current_slug: string): string {
	const index = devlog_posts.findIndex(p => p.slug === current_slug);
	if (index === -1)
		return '';

	// Posts are sorted newest first, so:
	// - "newer" post is at index - 1
	// - "older" post is at index + 1
	const newer = index > 0 ? devlog_posts[index - 1] : null;
	const older = index < devlog_posts.length - 1 ? devlog_posts[index + 1] : null;

	if (!newer && !older)
		return '';

	let html = '<nav class="post-nav">';

	if (older)
		html += `<a href="${older.slug}" class="post-nav-older">&lt;&lt; ${older.title}</a>`;
	else
		html += '<span class="post-nav-spacer"></span>';

	if (newer)
		html += `<a href="${newer.slug}" class="post-nav-newer">${newer.title} &gt;&gt;</a>`;

	html += '</nav>';
	return html;
}

async function generate_latest_post(): Promise<string> {
	if (devlog_posts.length === 0)
		return '';

	const latest = devlog_posts[0];
	const file_path = path.join(PAGE_DIR, `${latest.slug}.html`);
	const content = await Bun.file(file_path).text();

	// Parse the post content with template substitutions
	const rendered = await spooder.parse_template(content, {
		post_nav: () => generate_post_nav(latest.slug),
		comments: () => '', // no comments on front page
		likes: () => generate_like_button(latest.slug),
		...global_sub_table
	}, true);

	// Add link to view post for comments
	return rendered + `<a class="view-post-link" href="${latest.slug}">View Post to Comment</a>`;
}
// endregion

await (async () => {
	const pages = await fs.readdir(PAGE_DIR, { recursive: true });
	for (const page of pages) {
		if (!page.endsWith('.html'))
			continue;

		const page_path = path.join(PAGE_DIR, page);

		// Convert path separators to forward slashes for URL and remove .html extension
		let slug = '/' + page.replace(/\\/g, '/').replace(/\.html$/, '');
		if (slug === PAGE_INDEX)
			slug = '/';

		server.route(slug, async (req, url) => {
			// check cache first - if entry exists and valid, use cache.request()
			const cached_entry = cache.entries.get(slug);
			if (cached_entry && (Date.now() - cached_entry.cached_ts < CACHE_TTL)) {
				return cache.request(req, slug, () => cached_entry.content);
			}

			// reset pending flag before parsing
			request_has_pending_thumbs = false;

			const content = await Bun.file(page_path).text();
			const h1_match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i);
			const page_title = h1_match?.[1] ?? PAGE_DEFAULT_TITLE;

			// comments only on post pages, not on front page
			const is_post_page = slug.startsWith('/posts/');

			const rendered = await spooder.parse_template(
				await template_page(content),
				{
					page_title,
					post_list: generate_post_list,
					post_nav: () => generate_post_nav(slug),
					latest_post: generate_latest_post,
					comments: is_post_page ? () => get_comments_for_post(slug) : () => '',
					likes: is_post_page ? () => generate_like_button(slug) : () => '',
					...global_sub_table
				},
				true
			);

			// don't cache post pages (they have dynamic comments) or pages with pending thumbnails
			if (request_has_pending_thumbs || is_post_page) {
				return new Response(rendered, {
					headers: { 'Content-Type': 'text/html; charset=utf-8' }
				});
			}

			return cache.request(req, slug, () => rendered);
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

// region thumb-status
server.route('/thumb-status', async (req, url) => {
	const keys = url.searchParams.get('keys');
	if (!keys)
		return new Response('{}', { headers: { 'Content-Type': 'application/json' } });

	const key_list = keys.split(',');
	const hash_table = spooder.cache_bust_get_hash_table();
	const result: Record<string, string | false> = {};

	for (const key of key_list) {
		if (is_thumb_ready(key)) {
			// find original image path to get hash
			// key is like: static/images/thumbs/artwork/foo_530.webp
			// we need: static/images/artwork/foo.png (but we don't know the extension)
			// instead, just check if file exists and return a simple cache bust
			try {
				await fs.access(key);
				const thumb_hash = hash_table[key] ?? Date.now().toString(36);
				result[key] = `/${key}?v=${thumb_hash}`;
			} catch {
				result[key] = false;
			}
		} else {
			result[key] = false;
		}
	}

	return new Response(JSON.stringify(result), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store'
		}
	});
});
// endregion

// region contact form
const CONTACT_RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const CONTACT_RATE_LIMIT_MAX = 2; // max 2 requests per hour per IP
const contact_rate_limit: Map<string, number[]> = new Map();

function get_client_ip(req: Request): string {
	const forwarded = req.headers.get('x-forwarded-for');
	if (forwarded) {
		const first = forwarded.split(',')[0].trim();
		if (first)
			return first;
	}

	return 'unknown';
}

function is_rate_limited(ip: string): boolean {
	const now = Date.now();
	const timestamps = contact_rate_limit.get(ip) ?? [];

	// filter out old timestamps
	const recent = timestamps.filter(ts => now - ts < CONTACT_RATE_LIMIT_WINDOW);

	if (recent.length >= CONTACT_RATE_LIMIT_MAX)
		return true;

	recent.push(now);
	contact_rate_limit.set(ip, recent);
	return false;
}

type ContactFormData = {
	name: string;
	email: string;
	subject: string;
	message: string;
};

function validate_contact_form(data: unknown): { valid: true; data: ContactFormData } | { valid: false; error: string; field?: string } {
	if (!data || typeof data !== 'object')
		return { valid: false, error: 'Invalid request body' };

	const { name, email, subject, message } = data as Record<string, unknown>;

	// validate name
	if (typeof name !== 'string' || name.length < 2)
		return { valid: false, error: 'Name must be at least 2 characters', field: 'name' };

	if (name.length > 100)
		return { valid: false, error: 'Name must be less than 100 characters', field: 'name' };

	// validate email
	if (typeof email !== 'string' || !email)
		return { valid: false, error: 'Email is required', field: 'email' };

	if (email.length > 254)
		return { valid: false, error: 'Email must be less than 254 characters', field: 'email' };

	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		return { valid: false, error: 'Please enter a valid email address', field: 'email' };

	// validate subject
	if (typeof subject !== 'string' || subject.length < 3)
		return { valid: false, error: 'Subject must be at least 3 characters', field: 'subject' };

	if (subject.length > 200)
		return { valid: false, error: 'Subject must be less than 200 characters', field: 'subject' };

	// validate message
	if (typeof message !== 'string' || message.length < 10)
		return { valid: false, error: 'Message must be at least 10 characters', field: 'message' };
	
	if (message.length > 5000)
		return { valid: false, error: 'Message must be less than 5000 characters', field: 'message' };

	return {
		valid: true,
		data: { name, email, subject, message }
	};
}

function escape_html(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

server.json('/api/contact', async (req, url, json) => {
	const ip = get_client_ip(req);
	if (is_rate_limited(ip))
		return spooder.HTTP_STATUS_CODE.TooManyRequests_429;

	const validation = validate_contact_form(json);
	if (!validation.valid)
		return { status: 400, error: validation.error, field: validation.field };

	const { name, email, subject, message } = validation.data;

	// check required env vars
	const smtp_uri = process.env.SMTP_URI;
	const contact_email = process.env.CONTACT_EMAIL;
	const smtp_from = process.env.SMTP_FROM;

	if (!smtp_uri || !contact_email || !smtp_from) {
		spooder.caution('missing SMTP configuration');
		return spooder.HTTP_STATUS_CODE.InternalServerError_500;
	}

	// build email content
	const template_data = {
		name: escape_html(name),
		email: escape_html(email),
		subject: escape_html(subject),
		message: escape_html(message),
		ip: escape_html(ip),
		time: new Date().toISOString()
	};

	const email_template = await Bun.file('./html/email/contact.html').text();
	const html_content = await spooder.parse_template(email_template, template_data, false);

	// fire and forget - don't block the response
	smtp_send({
		uri: smtp_uri,
		from: smtp_from,
		to: contact_email,
		subject: `[Contact Form] ${subject}`,
		text: '',
		html: html_content
	}).catch(err => spooder.caution('failed to send contact form', { err }));

	return { success: true };
});
// endregion

// region mail queue
type MailTemplate = {
	subject: string;
	content: string[];
};

const mail_template_cache = new Map<string, MailTemplate>();

async function load_mail_template(template_id: string): Promise<MailTemplate> {
	let template = mail_template_cache.get(template_id);
	if (!template) {
		const file = Bun.file(`./mail/templates/${template_id}.json`);
		template = await file.json() as MailTemplate;
		mail_template_cache.set(template_id, template);
	}
	return JSON.parse(JSON.stringify(template)); // deep clone
}

async function load_mail_base_template(): Promise<string> {
	let base = mail_template_cache.get('__base__') as unknown as string;
	if (!base) {
		base = await Bun.file('./mail/template.html').text();
		mail_template_cache.set('__base__', base as unknown as MailTemplate);
	}
	return base;
}

async function send_templated_email(template_id: string, to: string, replacements: Record<string, string>) {
	const smtp_uri = process.env.SMTP_URI;
	const smtp_from = process.env.SMTP_FROM;

	if (!smtp_uri || !smtp_from) {
		spooder.caution('missing SMTP configuration for templated email');
		return;
	}

	const template = await load_mail_template(template_id);

	// apply replacements to content
	for (let i = 0; i < template.content.length; i++) {
		for (const key in replacements)
			template.content[i] = template.content[i].replace(`%${key}%`, replacements[key]);
	}

	// render HTML
	const base_html = await load_mail_base_template();
	const lines = base_html.split(/\r?\n/);
	const template_index = lines.findIndex(line => line.includes('<!-- TEMPLATE CONTENT -->'));

	const template_content = template.content.flatMap(content =>
		lines[template_index].replace('<!-- TEMPLATE CONTENT -->', content)
	);

	lines.splice(template_index, 1, ...template_content);
	const html = lines.join('\n');

	// plain text version
	const text = template.content.join('\n\n').replace(/<[^>]+>/g, '');

	// fire and forget - don't block the caller
	smtp_send({
		uri: smtp_uri,
		from: smtp_from,
		to,
		subject: template.subject,
		text,
		html
	}).catch(err => spooder.caution('failed to send templated email', { err, template_id, to }));
}
// endregion

// region comments
const COMMENT_SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const COMMENT_VERIFY_DURATION = 60 * 60 * 1000; // 1 hour
const COMMENT_RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const COMMENT_RATE_LIMIT_MAX = 5; // max 5 comments per hour per IP
const comment_rate_limit: Map<string, number[]> = new Map();

function is_comment_rate_limited(ip: string): boolean {
	const now = Date.now();
	const timestamps = comment_rate_limit.get(ip) ?? [];
	const recent = timestamps.filter(ts => now - ts < COMMENT_RATE_LIMIT_WINDOW);

	if (recent.length >= COMMENT_RATE_LIMIT_MAX)
		return true;

	recent.push(now);
	comment_rate_limit.set(ip, recent);
	return false;
}

async function notify_comment_posted(post_slug: string, display_name: string, email: string, content: string) {
	const smtp_uri = process.env.SMTP_URI;
	const contact_email = process.env.CONTACT_EMAIL;
	const smtp_from = process.env.SMTP_FROM;

	if (!smtp_uri || !contact_email || !smtp_from)
		return;

	const template_data = {
		post_slug: escape_html(post_slug),
		display_name: escape_html(display_name),
		email: escape_html(email),
		content: escape_html(content),
		time: new Date().toISOString()
	};

	const email_template = await Bun.file('./html/email/comment.html').text();
	const html_content = await spooder.parse_template(email_template, template_data, false);

	smtp_send({
		uri: smtp_uri,
		from: smtp_from,
		to: contact_email,
		subject: `[Comment] New comment on ${post_slug}`,
		text: '',
		html: html_content
	}).catch(err => spooder.caution('failed to send comment notification', { err }));
}

type CommentFormData = {
	post_slug: string;
	display_name: string;
	email: string;
	content: string;
};

function validate_comment_form(data: unknown): { valid: true; data: CommentFormData } | { valid: false; error: string; field?: string } {
	if (!data || typeof data !== 'object')
		return { valid: false, error: 'Invalid request body' };

	const { post_slug, display_name, email, content } = data as Record<string, unknown>;

	if (typeof post_slug !== 'string' || !post_slug.startsWith('/posts/'))
		return { valid: false, error: 'Invalid post' };

	if (typeof display_name !== 'string' || display_name.length < 2)
		return { valid: false, error: 'Name must be at least 2 characters', field: 'display_name' };

	if (display_name.length > 100)
		return { valid: false, error: 'Name must be less than 100 characters', field: 'display_name' };

	if (typeof email !== 'string' || !email)
		return { valid: false, error: 'Email is required', field: 'email' };

	if (email.length > 254)
		return { valid: false, error: 'Email must be less than 254 characters', field: 'email' };

	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		return { valid: false, error: 'Please enter a valid email address', field: 'email' };

	if (typeof content !== 'string' || content.length < 3)
		return { valid: false, error: 'Comment must be at least 3 characters', field: 'content' };

	if (content.length > 2000)
		return { valid: false, error: 'Comment must be less than 2000 characters', field: 'content' };

	return {
		valid: true,
		data: { post_slug, display_name, email, content }
	};
}

// submit a comment (creates pending session if needed, sends verification email)
server.json('/api/comments/submit', async (req, url, json) => {
	const ip = get_client_ip(req);
	if (is_comment_rate_limited(ip))
		return spooder.HTTP_STATUS_CODE.TooManyRequests_429;

	const validation = validate_comment_form(json);
	if (!validation.valid)
		return { status: 400, error: validation.error, field: validation.field };

	const { post_slug, display_name, email, content } = validation.data;

	// check if user has a valid verified session (via cookie)
	const cookie_header = req.headers.get('cookie') ?? '';
	const session_match = cookie_header.match(/comment_session=([a-f0-9]{64})/);
	const existing_token = session_match?.[1];

	if (existing_token) {
		// check if session is valid and verified
		const [session] = await db`SELECT token, email, verified_at, expires_at FROM comment_sessions WHERE token = ${existing_token}`;
		if (session && session.verified_at && new Date(session.expires_at) > new Date() && session.email === email) {
			// session is valid, post comment directly
			await db`INSERT INTO comments (post_slug, session_token, content) VALUES (${post_slug}, ${existing_token}, ${escape_html(content)})`;

			// extend session
			const new_expires = new Date(Date.now() + COMMENT_SESSION_DURATION);
			await db`UPDATE comment_sessions SET expires_at = ${new_expires}, display_name = ${display_name} WHERE token = ${existing_token}`;

			// notify me
			notify_comment_posted(post_slug, display_name, email, content);

			return { success: true, verified: true };
		}
	}

	// create new pending session
	const token = crypto.randomBytes(32).toString('hex');
	const expires_at = new Date(Date.now() + COMMENT_VERIFY_DURATION);

	await db`INSERT INTO comment_sessions (token, email, display_name, expires_at) VALUES (${token}, ${email}, ${display_name}, ${expires_at})`;

	// store pending comment content in session for retrieval after verification
	// we'll use a simple approach: store it temporarily and post it after verify
	await db`INSERT INTO comments (post_slug, session_token, content) VALUES (${post_slug}, ${token}, ${escape_html(content)})`;

	// send verification email
	await send_templated_email('comment_verify', email, {
		display_name: escape_html(display_name),
		token
	});

	return { success: true, verified: false, message: 'Please check your email to verify and post your comment.' };
});

// verify email and activate session
server.route('/api/comments/verify', async (req, url) => {
	const token = url.searchParams.get('token');
	if (!token || !/^[a-f0-9]{64}$/.test(token))
		return new Response('Invalid token', { status: 400 });

	const [session] = await db`SELECT token, email, display_name, verified_at, expires_at FROM comment_sessions WHERE token = ${token}`;
	if (!session)
		return new Response('Session not found or expired', { status: 404 });

	if (new Date(session.expires_at) < new Date()) {
		// clean up expired session and its comments
		await db`DELETE FROM comments WHERE session_token = ${token}`;
		await db`DELETE FROM comment_sessions WHERE token = ${token}`;
		return new Response('Verification link has expired. Please try posting your comment again.', { status: 410 });
	}

	const is_first_verification = !session.verified_at;

	if (is_first_verification) {
		// mark as verified and extend expiry
		const new_expires = new Date(Date.now() + COMMENT_SESSION_DURATION);
		await db`UPDATE comment_sessions SET verified_at = NOW(), expires_at = ${new_expires} WHERE token = ${token}`;
	}

	// find which post this comment belongs to
	const [comment] = await db`SELECT post_slug, content FROM comments WHERE session_token = ${token} LIMIT 1`;
	const redirect_url = comment?.post_slug ?? '/devlog';

	// notify me on first verification (when comment becomes visible)
	if (is_first_verification && comment) {
		notify_comment_posted(comment.post_slug, session.display_name, session.email, comment.content);
	}

	// set cookie and redirect
	const cookie_expires = new Date(Date.now() + COMMENT_SESSION_DURATION);
	return new Response(null, {
		status: 302,
		headers: {
			'Location': redirect_url + '?comment_posted=1',
			'Set-Cookie': `comment_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${cookie_expires.toUTCString()}`
		}
	});
});

// get comments for a post (used by template)
async function get_comments_for_post(post_slug: string): Promise<string> {
	const comments = await db`
		SELECT c.content, c.created_at, s.display_name
		FROM comments c
		JOIN comment_sessions s ON c.session_token = s.token
		WHERE c.post_slug = ${post_slug} AND s.verified_at IS NOT NULL
		ORDER BY c.created_at ASC
	`;

	let html = '<div class="comments-section">';
	html += '<h2>Comments</h2>';

	if (comments.length === 0) {
		html += '<p class="no-comments">No comments yet. Be the first to comment!</p>';
	} else {
		html += '<div class="comments-list">';
		for (const comment of comments) {
			const date = new Date(comment.created_at);
			const date_str = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
			html += `<div class="comment">`;
			html += `<div class="comment-header"><span class="comment-author">${comment.display_name}</span><time>${date_str}</time></div>`;
			html += `<div class="comment-content">${comment.content}</div>`;
			html += `</div>`;
		}
		html += '</div>';
	}

	html += `
	<form class="comment-form" id="comment-form">
		<h3>Leave a Comment</h3>
		<div class="form-group">
			<label for="comment-name">Name</label>
			<input type="text" id="comment-name" name="display_name" required minlength="2" maxlength="100">
			<div class="form-error" id="comment-name-error"></div>
		</div>
		<div class="form-group">
			<label for="comment-email">Email</label>
			<input type="email" id="comment-email" name="email" required maxlength="254">
			<div class="form-error" id="comment-email-error"></div>
			<p class="form-hint">Your email won't be displayed publicly. Used for verification only.</p>
		</div>
		<div class="form-group">
			<label for="comment-content">Comment</label>
			<textarea id="comment-content" name="content" required minlength="3" maxlength="2000"></textarea>
			<div class="form-error" id="comment-content-error"></div>
		</div>
		<input type="hidden" name="post_slug" value="${post_slug}">
		<div class="button-tray">
			<button type="submit" id="comment-submit">Post Comment</button>
		</div>
		<div id="comment-status"></div>
	</form>`;

	html += '</div>';
	return html;
}

// like button for posts
async function get_like_count(post_slug: string): Promise<number> {
	const [result] = await db`SELECT COUNT(*) as count FROM post_likes WHERE post_slug = ${post_slug}`;
	return Number(result?.count ?? 0);
}

async function generate_like_button(post_slug: string): Promise<string> {
	const count = await get_like_count(post_slug);
	return `<div class="like-container"><span class="like-label">Liked like? Leave a cheese:</span> <button class="like-button" data-post-slug="${post_slug}"><img src="/static/favicon-96x96.png" alt="Like" width="16" height="16"><span class="like-count">${count}</span></button></div>`;
}

// toggle like for a post
server.json('/api/likes/toggle', async (req, url, json) => {
	if (!json || typeof json !== 'object')
		return { status: 400, error: 'Invalid request' };

	const { post_slug, visitor_id } = json as Record<string, unknown>;

	if (typeof post_slug !== 'string' || !post_slug.startsWith('/posts/'))
		return { status: 400, error: 'Invalid post' };

	if (typeof visitor_id !== 'string' || !/^[a-f0-9]{32}$/.test(visitor_id))
		return { status: 400, error: 'Invalid visitor ID' };

	// check if already liked
	const [existing] = await db`SELECT 1 FROM post_likes WHERE post_slug = ${post_slug} AND visitor_id = ${visitor_id}`;

	if (existing) {
		// unlike
		await db`DELETE FROM post_likes WHERE post_slug = ${post_slug} AND visitor_id = ${visitor_id}`;
	} else {
		// like
		await db`INSERT INTO post_likes (post_slug, visitor_id) VALUES (${post_slug}, ${visitor_id})`;
	}

	const count = await get_like_count(post_slug);
	return { success: true, liked: !existing, count };
});

// get like status for a post
server.json('/api/likes/status', async (req, url, json) => {
	if (!json || typeof json !== 'object')
		return { status: 400, error: 'Invalid request' };

	const { post_slug, visitor_id } = json as Record<string, unknown>;

	if (typeof post_slug !== 'string' || !post_slug.startsWith('/posts/'))
		return { status: 400, error: 'Invalid post' };

	if (typeof visitor_id !== 'string' || !/^[a-f0-9]{32}$/.test(visitor_id))
		return { status: 400, error: 'Invalid visitor ID' };

	const [existing] = await db`SELECT 1 FROM post_likes WHERE post_slug = ${post_slug} AND visitor_id = ${visitor_id}`;
	const count = await get_like_count(post_slug);

	return { liked: !!existing, count };
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
// pixel font system
const global_pixel_fonts = new Map();

async function load_pixel_font_bin(font_name, bin_path) {
	if (global_pixel_fonts.has(font_name))
		return;

	const res = await fetch(bin_path);
	const array_buffer = await res.arrayBuffer();
	const data = new DataView(array_buffer);

	const magic = String.fromCharCode(data.getUint8(0), data.getUint8(1), data.getUint8(2), data.getUint8(3));
	if (magic !== 'PFNT')
		throw new Error('invalid font binary: bad magic');

	const version = data.getUint32(4, true);
	if (version !== 1)
		throw new Error('unsupported font binary version: ' + version);

	const num_sizes = data.getUint16(8, true);

	const toc_entries = [];
	let toc_offset = 10;
	for (let i = 0; i < num_sizes; i++) {
		const entry_pt_size = data.getUint16(toc_offset, true);
		const pixel_height = data.getUint16(toc_offset + 2, true);
		const char_count = data.getUint16(toc_offset + 4, true);
		const data_offset = data.getUint32(toc_offset + 6, true);
		const png_offset = data.getUint32(toc_offset + 10, true);
		const png_size = data.getUint32(toc_offset + 14, true);

		toc_entries.push({ entry_pt_size, pixel_height, char_count, data_offset, png_offset, png_size });
		toc_offset += 18;
	}

	for (const entry of toc_entries) {
		const characters = {};
		let char_offset = entry.data_offset;
		for (let i = 0; i < entry.char_count; i++) {
			const char_code = data.getUint16(char_offset, true);
			const x = data.getUint16(char_offset + 2, true);
			const y = data.getUint16(char_offset + 4, true);
			const width = data.getUint8(char_offset + 6);
			const height = data.getUint8(char_offset + 7);

			characters[String.fromCharCode(char_code)] = { x, y, width, height };
			char_offset += 8;
		}

		const png_data = array_buffer.slice(entry.png_offset, entry.png_offset + entry.png_size);
		const img = await createImageBitmap(new Blob([png_data], { type: 'image/png' }));

		const full_font_name = font_name + '-' + entry.entry_pt_size + 'pt';
		global_pixel_fonts.set(full_font_name, {
			metadata: { pixel_height: entry.pixel_height, characters },
			image: img
		});
	}
}

function get_closest_font(font_name, target_size) {
	const available_sizes = [];
	for (const [key] of global_pixel_fonts) {
		if (key.startsWith(font_name + '-')) {
			const match = key.match(/-(\d+)pt$/);
			if (match)
				available_sizes.push(parseInt(match[1]));
		}
	}

	if (available_sizes.length === 0)
		return null;

	available_sizes.sort((a, b) => a - b);

	let closest = available_sizes[0];
	let min_diff = Math.abs(target_size - closest);

	for (const size of available_sizes) {
		const diff = Math.abs(target_size - size);
		if (diff < min_diff) {
			min_diff = diff;
			closest = size;
		}
	}

	return global_pixel_fonts.get(font_name + '-' + closest + 'pt');
}

function render_pixel_text(canvas, text, font_name, size, color, bold) {
	const font = get_closest_font(font_name, size);
	if (!font)
		return;

	const { metadata, image } = font;
	const bold_spacing = bold ? 1 : 0;
	const bold_offset = bold ? 1 : 0;
	const text_chars = Array.from(text);

	let width = 0;
	for (const char of text_chars) {
		const cd = metadata.characters[char];
		if (cd)
			width += cd.width + bold_spacing;
	}
	width += bold_offset;

	canvas.width = width;
	canvas.height = metadata.pixel_height;

	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, width, metadata.pixel_height);

	let x = 0;
	for (const char of text_chars) {
		const cd = metadata.characters[char];
		if (!cd)
			continue;

		ctx.drawImage(image, cd.x, cd.y, cd.width, cd.height, x, 0, cd.width, cd.height);

		if (bold)
			ctx.drawImage(image, cd.x, cd.y, cd.width, cd.height, x + 1, 0, cd.width, cd.height);

		x += cd.width + bold_spacing;
	}

	if (color && color !== '#ffffff') {
		ctx.globalCompositeOperation = 'source-in';
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, width, metadata.pixel_height);
		ctx.globalCompositeOperation = 'source-over';
	}
}

function create_pixel_canvas(text, font_name, size, color, bold, scale) {
	const canvas = document.createElement('canvas');
	canvas.className = 'pixel-heading-canvas';
	render_pixel_text(canvas, text, font_name, size, color, bold);
	canvas.style.width = (canvas.width * scale) + 'px';
	return canvas;
}

// bootstrap pixel font rendering
document.addEventListener('DOMContentLoaded', async function() {
	try {
		await load_pixel_font_bin('sserife', '/static/fonts/sserife.pfnt');
	} catch (e) {
		console.error('failed to load pixel font:', e);
		return;
	}

	// titlebars
	const titlebars = document.querySelectorAll('.titlebar');
	for (const tb of titlebars) {
		const title_span = tb.querySelector('.title');
		const data_attr = title_span?.dataset.pixelTitle;
		const text = data_attr || title_span?.textContent;
		if (!text)
			continue;

		const is_active = tb.classList.contains('active');
		const color = is_active ? '#ffffff' : '#c0c0c0';
		const canvas = create_pixel_canvas(text, 'sserife', 10, color, true, 1);
		canvas.style.display = 'inline-block';
		canvas.style.verticalAlign = 'middle';

		if (title_span) {
			title_span.textContent = '';
			title_span.appendChild(canvas);
		} else {
			tb.appendChild(canvas);
		}
	}

	// desktop icon labels
	const icons = document.querySelectorAll('.desktop-icon span');
	for (const span of icons) {
		const text = span.textContent;
		const canvas = create_pixel_canvas(text, 'sserife', 10, '#ffffff', false, 1);
		canvas.style.display = 'block';
		span.textContent = '';
		span.appendChild(canvas);
	}

	// taskbar button labels
	const taskbar_labels = document.querySelectorAll('.taskbar-btn span');
	for (const span of taskbar_labels) {
		const text = span.textContent;
		const canvas = create_pixel_canvas(text, 'sserife', 8, '#000000', true, 1);
		canvas.style.display = 'inline-block';
		canvas.style.verticalAlign = 'middle';
		span.textContent = '';
		span.appendChild(canvas);
	}

	// all UI buttons and nav links
	const ui_buttons = document.querySelectorAll('.btn-skew, .post-nav a');
	for (const btn of ui_buttons) {
		const text = btn.textContent.trim();
		if (!text)
			continue;

		const canvas = create_pixel_canvas(text, 'sserife', 10, '#000000', true, 1);
		canvas.style.display = 'inline-block';
		canvas.style.verticalAlign = 'middle';
		btn.textContent = '';
		btn.appendChild(canvas);
	}

	// content headings
	const headings = document.querySelectorAll('#window-body h1, #window-body h2');
	for (const heading of headings) {
		const text = heading.textContent;
		const is_h1 = heading.tagName === 'H1';
		const size = is_h1 ? 14 : 10;
		const scale = is_h1 ? 3 : 2.5;
		const canvas = create_pixel_canvas(text, 'sserife', size, '#000000', true, scale);
		canvas.style.marginBottom = is_h1 ? '10px' : '5px';

		heading.classList.add('pixel-heading-sr');
		heading.parentNode.insertBefore(canvas, heading);
	}

	// taskbar clock
	const clock_el = document.getElementById('taskbar-clock');
	if (clock_el) {
		function update_clock() {
			const now = new Date();
			let hours = now.getHours();
			const minutes = now.getMinutes().toString().padStart(2, '0');
			const ampm = hours >= 12 ? 'PM' : 'AM';
			hours = hours % 12 || 12;
			const time_str = hours + ':' + minutes + ' ' + ampm;

			clock_el.textContent = '';
			const canvas = document.createElement('canvas');
			canvas.className = 'pixel-heading-canvas';
			render_pixel_text(canvas, time_str, 'sserife', 10, '#000000', false);
			canvas.style.width = canvas.width + 'px';
			canvas.style.height = canvas.height + 'px';
			clock_el.appendChild(canvas);
		}

		update_clock();
		setInterval(update_clock, 30000);
	}
});

// avatar window dragging
(function() {
	const avatar_window = document.getElementById('avatar-window');
	if (!avatar_window)
		return;

	const titlebar = avatar_window.querySelector('.titlebar');
	if (!titlebar)
		return;

	let is_dragging = false;
	let drag_offset_x = 0;
	let drag_offset_y = 0;

	titlebar.addEventListener('pointerdown', function(e) {
		is_dragging = true;

		// offset between pointer and avatar's current CSS position
		const parent_rect = avatar_window.offsetParent.getBoundingClientRect();
		drag_offset_x = e.clientX - (avatar_window.offsetLeft + parent_rect.left);
		drag_offset_y = e.clientY - (avatar_window.offsetTop + parent_rect.top);

		titlebar.setPointerCapture(e.pointerId);
		e.preventDefault();
	});

	document.addEventListener('pointermove', function(e) {
		if (!is_dragging)
			return;

		const parent_rect = avatar_window.offsetParent.getBoundingClientRect();
		avatar_window.style.left = (e.clientX - parent_rect.left - drag_offset_x) + 'px';
		avatar_window.style.top = (e.clientY - parent_rect.top - drag_offset_y) + 'px';
	});

	document.addEventListener('pointerup', function() {
		is_dragging = false;
	});
})();

// image popout
const image_popout_overlay = document.getElementById('image-popout-overlay');
const image_popout_close = document.getElementById('image-popout-close');
const image_popout_img = document.querySelector('#image-popout-img-wrapper > img');
const image_popout_title = document.getElementById('image-popout-title');

function open_image_popout(src, title) {
	image_popout_img.src = src;
	image_popout_title.textContent = title || '';
	image_popout_overlay.classList.add('open');
}

function close_image_popout() {
	image_popout_overlay.classList.remove('open');
	image_popout_img.src = '';
	image_popout_title.textContent = '';
}

image_popout_close.addEventListener('click', close_image_popout);
image_popout_overlay.addEventListener('click', function(e) {
	if (e.target === image_popout_overlay || e.target === image_popout_overlay.querySelector('#image-popout-container') || e.target === image_popout_overlay.querySelector('#image-popout-img-wrapper'))
		close_image_popout();
});

document.addEventListener('click', function(e) {
	const popout_image = e.target.closest('.image-popout');
	if (popout_image) {
		const full_src = popout_image.dataset.fullSrc;
		if (full_src)
			open_image_popout(full_src, popout_image.dataset.title);
	}
});

document.addEventListener('keydown', function(e) {
	if (e.key === 'Escape' && image_popout_overlay.classList.contains('open'))
		close_image_popout();
});

// pending thumbnail polling
(function() {
	const pending_images = document.querySelectorAll('[data-pending-thumb]');
	if (pending_images.length === 0)
		return;

	const pending = new Map();
	pending_images.forEach(el => {
		pending.set(el.dataset.pendingThumb, el);
	});

	function poll_thumbs() {
		if (pending.size === 0)
			return;

		const keys = Array.from(pending.keys()).join(',');
		fetch('/thumb-status?keys=' + encodeURIComponent(keys))
			.then(res => res.json())
			.then(result => {
				for (const [key, src] of Object.entries(result)) {
					if (src === false)
						continue;

					const el = pending.get(key);
					if (!el)
						continue;

					const img = document.createElement('img');
					img.src = src;
					img.onload = function() {
						el.appendChild(img);
						el.classList.remove('image-pending');
						el.style.width = '';
						el.style.height = '';
						el.style.aspectRatio = '';

						const full_src = el.dataset.thumbFullSrc;
						if (full_src && el.classList.contains('image-popout'))
							el.dataset.fullSrc = full_src;
					};

					pending.delete(key);
				}

				if (pending.size > 0)
					setTimeout(poll_thumbs, 1000);
			})
			.catch(() => {
				setTimeout(poll_thumbs, 1000);
			});
	}

	setTimeout(poll_thumbs, 500);
})();

// contact form handling
(function() {
	const form = document.getElementById('contact-form');
	if (!form)
		return;

	const submit_btn = document.getElementById('contact-submit');
	const status_el = document.getElementById('contact-status');

	const fields = {
		name: {
			el: document.getElementById('contact-name'),
			validate: (v) => {
				if (!v || v.length < 2) return 'Name must be at least 2 characters';
				if (v.length > 100) return 'Name must be less than 100 characters';
				return null;
			}
		},
		email: {
			el: document.getElementById('contact-email'),
			validate: (v) => {
				if (!v) return 'Email is required';
				if (v.length > 254) return 'Email must be less than 254 characters';
				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Please enter a valid email address';
				return null;
			}
		},
		subject: {
			el: document.getElementById('contact-subject'),
			validate: (v) => {
				if (!v || v.length < 3) return 'Subject must be at least 3 characters';
				if (v.length > 200) return 'Subject must be less than 200 characters';
				return null;
			}
		},
		message: {
			el: document.getElementById('contact-message'),
			validate: (v) => {
				if (!v || v.length < 10) return 'Message must be at least 10 characters';
				if (v.length > 5000) return 'Message must be less than 5000 characters';
				return null;
			}
		}
	};

	function show_error(field, message) {
		const error_el = field.el.parentElement.querySelector('.form-error');
		field.el.classList.add('error');
		if (error_el) error_el.textContent = message;
	}

	function clear_error(field) {
		const error_el = field.el.parentElement.querySelector('.form-error');
		field.el.classList.remove('error');
		if (error_el) error_el.textContent = '';
	}

	function validate_all() {
		let valid = true;
		for (const [name, field] of Object.entries(fields)) {
			const error = field.validate(field.el.value.trim());
			if (error) {
				show_error(field, error);
				valid = false;
			} else {
				clear_error(field);
			}
		}
		return valid;
	}

	for (const field of Object.values(fields)) {
		field.el.addEventListener('input', () => clear_error(field));
	}

	form.addEventListener('submit', async function(e) {
		e.preventDefault();

		status_el.textContent = '';
		status_el.className = '';

		if (!validate_all())
			return;

		submit_btn.disabled = true;
		submit_btn.textContent = 'Sending...';

		try {
			const res = await fetch('/api/contact', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: fields.name.el.value.trim(),
					email: fields.email.el.value.trim(),
					subject: fields.subject.el.value.trim(),
					message: fields.message.el.value.trim()
				})
			});

			const data = await res.json();

			if (res.ok) {
				status_el.textContent = 'Message sent successfully!';
				status_el.className = 'success';
				form.reset();
			} else {
				status_el.textContent = data.error || 'Something went wrong. Please try again.';
				status_el.className = 'error';

				if (data.field && fields[data.field])
					show_error(fields[data.field], data.error);
			}
		} catch (err) {
			status_el.textContent = 'Failed to send message, did you already send one?';
			status_el.className = 'error';
		} finally {
			submit_btn.disabled = false;
			submit_btn.textContent = 'Send Message';
		}
	});
})();

// comment form handling
(function() {
	const form = document.getElementById('comment-form');
	if (!form)
		return;

	const submit_btn = document.getElementById('comment-submit');
	const status_el = document.getElementById('comment-status');
	const post_slug_input = form.querySelector('input[name="post_slug"]');

	const fields = {
		display_name: {
			el: document.getElementById('comment-name'),
			validate: (v) => {
				if (!v || v.length < 2)
					return 'Name must be at least 2 characters';

				if (v.length > 100)
					return 'Name must be less than 100 characters';

				return null;
			}
		},
		email: {
			el: document.getElementById('comment-email'),
			validate: (v) => {
				if (!v)
					return'Email is required';

				if (v.length > 254)
					return 'Email must be less than 254 characters';

				if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
					return 'Please enter a valid email address';

				return null;
			}
		},
		content: {
			el: document.getElementById('comment-content'),
			validate: (v) => {
				if (!v || v.length < 3)
					return 'Comment must be at least 3 characters';

				if (v.length > 2000)
					return 'Comment must be less than 2000 characters';

				return null;
			}
		}
	};

	function show_error(field, message) {
		const error_el = field.el.parentElement.querySelector('.form-error');
		field.el.classList.add('error');

		if (error_el)
			error_el.textContent = message;
	}

	function clear_error(field) {
		const error_el = field.el.parentElement.querySelector('.form-error');
		field.el.classList.remove('error');
		if (error_el)
			error_el.textContent = '';
	}

	function validate_all() {
		let valid = true;
		for (const [name, field] of Object.entries(fields)) {
			const error = field.validate(field.el.value.trim());
			if (error) {
				show_error(field, error);
				valid = false;
			} else {
				clear_error(field);
			}
		}
		return valid;
	}

	for (const field of Object.values(fields)) {
		field.el.addEventListener('input', () => clear_error(field));
	}

	const params = new URLSearchParams(window.location.search);
	if (params.get('comment_posted') === '1') {
		status_el.textContent = 'Your comment has been posted!';
		status_el.className = 'success';
		history.replaceState(null, '', window.location.pathname);
	}

	form.addEventListener('submit', async function(e) {
		e.preventDefault();

		status_el.textContent = '';
		status_el.className = '';

		if (!validate_all())
			return;

		submit_btn.disabled = true;
		submit_btn.textContent = 'Posting...';

		try {
			const res = await fetch('/api/comments/submit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					post_slug: post_slug_input.value,
					display_name: fields.display_name.el.value.trim(),
					email: fields.email.el.value.trim(),
					content: fields.content.el.value.trim()
				})
			});

			const data = await res.json();

			if (res.ok) {
				if (data.verified) {
					status_el.textContent = 'Comment posted!';
					status_el.className = 'success';
					setTimeout(() => window.location.reload(), 1000);
				} else {
					status_el.textContent = data.message || 'Check your email to verify and post your comment.';
					status_el.className = 'success';
					form.reset();
				}
			} else {
				status_el.textContent = data.error || 'Something went wrong. Please try again.';
				status_el.className = 'error';

				if (data.field && fields[data.field])
					show_error(fields[data.field], data.error);
			}
		} catch (err) {
			status_el.textContent = 'Failed to post comment. Please try again.';
			status_el.className = 'error';
		} finally {
			submit_btn.disabled = false;
			submit_btn.textContent = 'Post Comment';
		}
	});
})();

// subscribe form handling
(function() {
	const form = document.getElementById('subscribe-form');
	if (!form)
		return;

	const email_btn = document.getElementById('subscribe-email-btn');
	const email_input = document.getElementById('subscribe-email');
	const submit_btn = document.getElementById('subscribe-submit');
	const status_el = document.getElementById('subscribe-status');
	const error_el = document.getElementById('subscribe-email-error');

	if (email_btn) {
		email_btn.addEventListener('click', function() {
			form.classList.toggle('open');
			if (form.classList.contains('open'))
				email_input.focus();
		});
	}

	function show_error(message) {
		email_input.classList.add('error');
		error_el.textContent = message;
	}

	function clear_error() {
		email_input.classList.remove('error');
		error_el.textContent = '';
	}

	function validate_email(v) {
		if (!v)
			return 'Email is required';

		if (v.length > 254)
			return 'Email must be less than 254 characters';

		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
			return 'Please enter a valid email address';

		return null;
	}

	email_input.addEventListener('input', clear_error);

	form.addEventListener('submit', async function(e) {
		e.preventDefault();

		status_el.textContent = '';
		status_el.className = '';
		clear_error();

		const email = email_input.value.trim();
		const error = validate_email(email);
		if (error) {
			show_error(error);
			return;
		}

		submit_btn.disabled = true;
		submit_btn.textContent = 'Subscribing...';

		try {
			const res = await fetch('/api/subscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email })
			});

			const data = await res.json();

			if (res.ok) {
				status_el.textContent = data.message;
				status_el.className = 'success';
				if (data.verified || data.already_subscribed)
					form.reset();
			} else {
				status_el.textContent = data.error || 'Something went wrong. Please try again.';
				status_el.className = 'error';
				if (data.field === 'email')
					show_error(data.error);
			}
		} catch (err) {
			status_el.textContent = 'Failed to subscribe. Please try again.';
			status_el.className = 'error';
		} finally {
			submit_btn.disabled = false;
			submit_btn.textContent = 'Subscribe';
		}
	});

	const params = new URLSearchParams(window.location.search);
	if (params.get('subscribed') === '1') {
		form.classList.add('open');
		status_el.textContent = "You're now subscribed!";
		status_el.className = 'success';
		history.replaceState(null, '', window.location.pathname);
	}
})();

// like button handling
(function() {
	const like_buttons = document.querySelectorAll('.like-button');
	if (like_buttons.length === 0)
		return;

	function get_visitor_id() {
		let id = localStorage.getItem('visitor_id');
		if (!id) {
			const arr = new Uint8Array(16);
			crypto.getRandomValues(arr);
			id = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
			localStorage.setItem('visitor_id', id);
		}
		return id;
	}

	function get_liked_posts() {
		try {
			return JSON.parse(localStorage.getItem('liked_posts') || '[]');
		} catch {
			return [];
		}
	}

	function set_liked_posts(posts) {
		localStorage.setItem('liked_posts', JSON.stringify(posts));
	}

	const visitor_id = get_visitor_id();
	const liked_posts = get_liked_posts();
	const pending_requests = new Map();

	like_buttons.forEach(btn => {
		const post_slug = btn.dataset.postSlug;
		if (liked_posts.includes(post_slug))
			btn.classList.add('liked');
	});

	async function send_like_request(post_slug, desired_state) {
		try {
			const res = await fetch('/api/likes/toggle', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ post_slug, visitor_id })
			});

			const data = await res.json();

			if (res.ok) {
				like_buttons.forEach(btn => {
					if (btn.dataset.postSlug === post_slug) {
						const count_el = btn.querySelector('.like-count');
						if (count_el)
							count_el.textContent = data.count;
					}
				});
			}
		} catch (err) {
			// silently fail
		}
	}

	like_buttons.forEach(btn => {
		btn.addEventListener('click', function() {
			const post_slug = btn.dataset.postSlug;
			const is_now_liked = !btn.classList.contains('liked');

			like_buttons.forEach(b => {
				if (b.dataset.postSlug === post_slug) {
					if (is_now_liked)
						b.classList.add('liked');
					else
						b.classList.remove('liked');

					const count_el = b.querySelector('.like-count');
					if (count_el) {
						const current = parseInt(count_el.textContent) || 0;
						count_el.textContent = is_now_liked ? current + 1 : Math.max(0, current - 1);
					}
				}
			});

			if (is_now_liked) {
				if (!liked_posts.includes(post_slug)) {
					liked_posts.push(post_slug);
					set_liked_posts(liked_posts);
				}
			} else {
				const idx = liked_posts.indexOf(post_slug);
				if (idx > -1) {
					liked_posts.splice(idx, 1);
					set_liked_posts(liked_posts);
				}
			}

			if (pending_requests.has(post_slug))
				clearTimeout(pending_requests.get(post_slug));

			const timeout_id = setTimeout(() => {
				pending_requests.delete(post_slug);
				send_like_request(post_slug, is_now_liked);
			}, 1000);

			pending_requests.set(post_slug, timeout_id);
		});
	});
})();

// randomize doodle jitter animation phase
document.addEventListener('DOMContentLoaded', function() {
	document.querySelectorAll('.doodle').forEach(el => {
		el.style.animationDelay = '-' + (Math.random() * 0.6) + 's';
	});
});

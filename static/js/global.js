const nav_toggle = document.getElementById('nav-toggle');
const main_nav = document.getElementById('main-nav');
const nav_links = document.getElementById('nav-links');
const nav_overlay = document.getElementById('nav-overlay');

function open_nav() {
	main_nav.classList.add('open');
	nav_links.classList.add('open');
	nav_overlay.classList.add('open');
}

function close_nav() {
	main_nav.classList.remove('open');
	nav_links.classList.remove('open');
	nav_overlay.classList.remove('open');
}

nav_toggle.addEventListener('click', function(e) {
	e.stopPropagation();
	if (nav_links.classList.contains('open'))
		close_nav();
	else
		open_nav();
});

nav_overlay.addEventListener('click', close_nav);

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

// Pending thumbnail polling
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

					// create and insert image
					const img = document.createElement('img');
					img.src = src;
					img.onload = function() {
						el.appendChild(img);
						el.classList.remove('image-pending');
						el.style.width = '';
						el.style.height = '';
						el.style.aspectRatio = '';

						// enable popout if applicable
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
				// retry on error
				setTimeout(poll_thumbs, 1000);
			});
	}

	// start polling
	setTimeout(poll_thumbs, 500);
})();

// Contact form handling
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

	// Clear errors on input
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

				if (data.field && fields[data.field]) {
					show_error(fields[data.field], data.error);
				}
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

// Comment form handling
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

	// Clear errors on input
	for (const field of Object.values(fields)) {
		field.el.addEventListener('input', () => clear_error(field));
	}

	// Check for success message from redirect
	const params = new URLSearchParams(window.location.search);
	if (params.get('comment_posted') === '1') {
		status_el.textContent = 'Your comment has been posted!';
		status_el.className = 'success';
		// clean up URL
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
					// comment posted directly, reload to show it
					status_el.textContent = 'Comment posted!';
					status_el.className = 'success';
					setTimeout(() => window.location.reload(), 1000);
				} else {
					// verification email sent
					status_el.textContent = data.message || 'Check your email to verify and post your comment.';
					status_el.className = 'success';
					form.reset();
				}
			} else {
				status_el.textContent = data.error || 'Something went wrong. Please try again.';
				status_el.className = 'error';

				if (data.field && fields[data.field]) {
					show_error(fields[data.field], data.error);
				}
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

// Subscribe form handling
(function() {
	const form = document.getElementById('subscribe-form');
	if (!form)
		return;

	const email_btn = document.getElementById('subscribe-email-btn');
	const email_input = document.getElementById('subscribe-email');
	const submit_btn = document.getElementById('subscribe-submit');
	const status_el = document.getElementById('subscribe-status');
	const error_el = document.getElementById('subscribe-email-error');

	// Toggle email form visibility
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

	// Check for success message from redirect
	const params = new URLSearchParams(window.location.search);
	if (params.get('subscribed') === '1') {
		form.classList.add('open');
		status_el.textContent = "You're now subscribed!";
		status_el.className = 'success';
		history.replaceState(null, '', window.location.pathname);
	}
})();

// Like button handling
(function() {
	const like_buttons = document.querySelectorAll('.like-button');
	if (like_buttons.length === 0)
		return;

	// get or create visitor ID (stored in localStorage)
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

	// get liked posts from localStorage
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
	const pending_requests = new Map(); // post_slug -> timeout ID

	// initialize button states from localStorage
	like_buttons.forEach(btn => {
		const post_slug = btn.dataset.postSlug;
		if (liked_posts.includes(post_slug))
			btn.classList.add('liked');
	});

	// send the actual API request
	async function send_like_request(post_slug, desired_state) {
		try {
			const res = await fetch('/api/likes/toggle', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ post_slug, visitor_id })
			});

			const data = await res.json();

			if (res.ok) {
				// update all buttons for this post with server count
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

	// handle clicks
	like_buttons.forEach(btn => {
		btn.addEventListener('click', function() {
			const post_slug = btn.dataset.postSlug;

			// toggle visual state immediately
			const is_now_liked = !btn.classList.contains('liked');

			// update all buttons for this post
			like_buttons.forEach(b => {
				if (b.dataset.postSlug === post_slug) {
					if (is_now_liked)
						b.classList.add('liked');
					else
						b.classList.remove('liked');

					// optimistically update count
					const count_el = b.querySelector('.like-count');
					if (count_el) {
						const current = parseInt(count_el.textContent) || 0;
						count_el.textContent = is_now_liked ? current + 1 : Math.max(0, current - 1);
					}
				}
			});

			// update localStorage
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

			// debounce the API call
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

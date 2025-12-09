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

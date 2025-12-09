const navToggle = document.getElementById('nav-toggle');
const mainNav = document.getElementById('main-nav');
const navLinks = document.getElementById('nav-links');
const navOverlay = document.getElementById('nav-overlay');

function openNav() {
	mainNav.classList.add('open');
	navLinks.classList.add('open');
	navOverlay.classList.add('open');
}

function closeNav() {
	mainNav.classList.remove('open');
	navLinks.classList.remove('open');
	navOverlay.classList.remove('open');
}

navToggle.addEventListener('click', function(e) {
	e.stopPropagation();
	if (navLinks.classList.contains('open'))
		closeNav();
	else
		openNav();
});

navOverlay.addEventListener('click', closeNav);

const imagePopoutOverlay = document.getElementById('image-popout-overlay');
const imagePopoutClose = document.getElementById('image-popout-close');
const imagePopoutImg = document.querySelector('#image-popout-img-wrapper > img');
const imagePopoutTitle = document.getElementById('image-popout-title');

function openImagePopout(src, title) {
	imagePopoutImg.src = src;
	imagePopoutTitle.textContent = title || '';
	imagePopoutOverlay.classList.add('open');
}

function closeImagePopout() {
	imagePopoutOverlay.classList.remove('open');
	imagePopoutImg.src = '';
	imagePopoutTitle.textContent = '';
}

imagePopoutClose.addEventListener('click', closeImagePopout);
imagePopoutOverlay.addEventListener('click', function(e) {
	if (e.target === imagePopoutOverlay || e.target === imagePopoutOverlay.querySelector('#image-popout-container') || e.target === imagePopoutOverlay.querySelector('#image-popout-img-wrapper'))
		closeImagePopout();
});

document.addEventListener('click', function(e) {
	const popoutImage = e.target.closest('.image-popout');
	if (popoutImage) {
		const fullSrc = popoutImage.dataset.fullSrc;
		if (fullSrc)
			openImagePopout(fullSrc, popoutImage.dataset.title);
	}
});

document.addEventListener('keydown', function(e) {
	if (e.key === 'Escape' && imagePopoutOverlay.classList.contains('open'))
		closeImagePopout();
});

// Pending thumbnail polling
(function() {
	const pendingImages = document.querySelectorAll('[data-pending-thumb]');
	if (pendingImages.length === 0)
		return;

	const pending = new Map();
	pendingImages.forEach(el => {
		pending.set(el.dataset.pendingThumb, el);
	});

	function pollThumbs() {
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
						const fullSrc = el.dataset.thumbFullSrc;
						if (fullSrc && el.classList.contains('image-popout'))
							el.dataset.fullSrc = fullSrc;
					};

					pending.delete(key);
				}

				if (pending.size > 0)
					setTimeout(pollThumbs, 1000);
			})
			.catch(() => {
				// retry on error
				setTimeout(pollThumbs, 1000);
			});
	}

	// start polling
	setTimeout(pollThumbs, 500);
})();

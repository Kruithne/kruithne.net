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

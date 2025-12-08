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

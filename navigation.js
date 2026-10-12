const header = document.querySelector('.site-header');
const toggle = header?.querySelector('.menu-toggle');
const mainNavigation = header?.querySelector('.main-nav');
const actionNavigation = header?.querySelector('.header-actions');

if (header && toggle && mainNavigation && actionNavigation) {
  const closeMenu = () => {
    header.classList.remove('is-menu-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
  };

  toggle.addEventListener('click', () => {
    const isOpen = header.classList.toggle('is-menu-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  });

  header.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('pointerdown', (event) => {
    if (!header.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      toggle.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 840) closeMenu();
  });
}

import { showMessage, supabase } from './supabase.js';

const header = document.querySelector('.site-header');
const toggle = header?.querySelector('.menu-toggle');
const mainNavigation = header?.querySelector('.main-nav');
const actionNavigation = header?.querySelector('.header-actions');
const isAdminPage = Boolean(document.body.dataset.adminPage);

if (header && actionNavigation) {
  const adminPages = [
    ['admin.html', 'Overview'],
    ['admin.html#bookingRequests', 'Requests'],
    ['admin-tournaments.html', 'Tournaments'],
    ['admin-gamers.html', 'Gamers'],
    ['admin-slots.html', 'Slots'],
    ['admin-live.html', 'Live sessions'],
    ['admin-settings.html', 'Settings'],
  ];
  if (isAdminPage) {
    const brand = header.querySelector('.brand');
    if (brand) brand.href = 'admin.html';
    if (mainNavigation) {
      mainNavigation.setAttribute('aria-label', 'Admin navigation');
      mainNavigation.replaceChildren(...adminPages.map(([href, label]) => {
        const link = document.createElement('a');
        link.href = href;
        link.textContent = label;
        return link;
      }));
    }
  }

  const bookDemoButton = actionNavigation.querySelector('#bookDemoBtn');
  const sessionLink = document.createElement('a');
  sessionLink.className = 'explore-link';
  sessionLink.dataset.sessionLink = '';
  sessionLink.href = isAdminPage ? 'admin.html' : 'account.html';
  sessionLink.textContent = isAdminPage ? 'Admin hub' : 'Login';

  const logoutButton = document.createElement('button');
  logoutButton.id = 'signOutButton';
  logoutButton.className = 'nav-pill nav-logout';
  logoutButton.type = 'button';
  logoutButton.textContent = 'Logout';
  logoutButton.hidden = true;

  const feedback = document.createElement('span');
  feedback.className = 'nav-auth-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  actionNavigation.replaceChildren(sessionLink, ...(!isAdminPage && bookDemoButton ? [bookDemoButton] : []), logoutButton, feedback);

  const setAuthenticatedNavigation = (authenticated) => {
    header.classList.toggle('is-authenticated', authenticated);
    logoutButton.hidden = !authenticated;
    sessionLink.href = isAdminPage ? 'admin.html' : authenticated ? 'dashboard.html' : 'account.html';
    sessionLink.textContent = isAdminPage ? 'Admin hub' : authenticated ? 'Dashboard' : 'Login';
    const mobileLogin = header.querySelector('.mobile-login-link');
    if (mobileLogin) {
      mobileLogin.href = isAdminPage ? 'admin.html' : authenticated ? 'dashboard.html' : 'account.html';
      mobileLogin.textContent = isAdminPage ? 'Admin hub' : authenticated ? 'Dashboard' : 'Login';
    }
  };

  setAuthenticatedNavigation(false);
  if (supabase) {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        showMessage(feedback, error.message, true);
        return;
      }
      setAuthenticatedNavigation(Boolean(data.session?.user));
    }).catch((error) => {
      showMessage(feedback, error instanceof Error ? error.message : 'Could not load sign-in status.', true);
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticatedNavigation(Boolean(session?.user));
    });
  }

  logoutButton.addEventListener('click', async () => {
    if (!supabase) {
      showMessage(feedback, 'Supabase is not configured. You cannot sign out right now.', true);
      return;
    }
    logoutButton.disabled = true;
    showMessage(feedback, 'Signing out…');
    const { error } = await supabase.auth.signOut();
    logoutButton.disabled = false;
    if (error) {
      showMessage(feedback, error.message, true);
      return;
    }
    window.location.assign('account.html');
  });
}

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

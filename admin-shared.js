import { getCurrentUser, showMessage, supabase } from './supabase.js';

const pages = [
  ['admin.html', 'Overview'],
  ['admin-tournaments.html', 'Tournaments'],
  ['admin-gamers.html', 'Gamers & credit'],
  ['admin-slots.html', 'Slots & consoles'],
  ['admin-live.html', 'Live sessions'],
  ['admin-games.html', 'More games'],
  ['admin-settings.html', 'Settings'],
];

export const initializeAdminPage = async () => {
  const feedback = document.getElementById('adminFeedback');
  if (!supabase) {
    showMessage(feedback, 'Supabase is not configured. Add the project URL and publishable key.', true);
    return null;
  }
  const { user, error } = await getCurrentUser();
  if (error) {
    showMessage(feedback, error.message, true);
    return null;
  }
  if (!user) {
    window.location.replace('account.html');
    return null;
  }
  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('role').eq('id', user.id).single();
  if (profileError) {
    showMessage(feedback, profileError.message, true);
    return null;
  }
  if (profile.role !== 'admin') {
    window.location.replace('dashboard.html');
    return null;
  }

  const nav = document.getElementById('adminPageNav');
  const currentPage = document.body.dataset.adminPage;
  for (const [href, label] of pages) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (href === currentPage) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return { user, supabase };
};

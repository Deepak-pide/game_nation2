import { getCurrentUser, showMessage, supabase } from './supabase.js';

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

  document.getElementById('adminPageNav')?.remove();
  return { user, supabase };
};

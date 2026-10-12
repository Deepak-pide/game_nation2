import { configurationError, getCurrentUser, showMessage, supabase } from './supabase.js';
import { loadTournamentProfile } from './tournament-profile.js';

const feedback = document.getElementById('tournamentProfileFeedback');

const boot = async () => {
  if (configurationError) return showMessage(feedback, configurationError, true);
  const { user, error } = await getCurrentUser();
  if (error) return showMessage(feedback, error.message, true);
  if (!user) return window.location.replace('account.html');
  await loadTournamentProfile(supabase, user.id);
};

boot().catch((error) => {
  showMessage(feedback, error instanceof Error ? error.message : 'Could not load your tournament profile.', true);
});

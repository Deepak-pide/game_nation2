import { initializeAdminPage } from './admin-shared.js';
import { initializeTournamentAdmin } from './tournament-admin.js';

const start = async () => {
  const admin = await initializeAdminPage();
  if (admin) await initializeTournamentAdmin(admin.supabase);
};

start().catch((error) => {
  const feedback = document.getElementById('tournamentAdminFeedback');
  feedback.textContent = error instanceof Error ? error.message : 'Could not load tournament management.';
  feedback.classList.add('is-error');
});

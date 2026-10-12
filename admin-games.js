import { initializeAdminPage } from './admin-shared.js';
import { initializeGameAdmin } from './game-admin.js';

const start = async () => {
  const admin = await initializeAdminPage();
  if (admin) await initializeGameAdmin(admin.supabase);
};

start().catch((error) => {
  const feedback = document.getElementById('gameAdminFeedback');
  feedback.textContent = error instanceof Error ? error.message : 'Could not load the game library.';
  feedback.classList.add('is-error');
});

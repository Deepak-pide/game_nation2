import { showMessage } from './supabase.js';
import { initializeAdminPage } from './admin-shared.js';

const feedback = document.getElementById('walletAdminFeedback');

const start = async () => {
  const admin = await initializeAdminPage();
  if (!admin) return;
  const { supabase } = admin;
  const form = document.getElementById('walletRateForm');
  const input = form.elements.hourly_rate;
  const { data, error } = await supabase.from('wallet_settings')
    .select('hourly_rate').eq('singleton', true).single();
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  input.value = Number(data.hourly_rate).toFixed(2);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const { error: saveError } = await supabase.rpc('admin_set_wallet_hourly_rate', {
      p_hourly_rate: Number(input.value),
    });
    button.disabled = false;
    showMessage(feedback, saveError
      ? saveError.message
      : 'Conversion rate saved. New live-session minutes use this hourly value.', Boolean(saveError));
  });
};

start().catch((error) => showMessage(feedback, error instanceof Error ? error.message : 'Could not load data settings.', true));

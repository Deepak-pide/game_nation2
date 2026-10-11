import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configurationError = !supabaseUrl || !supabasePublishableKey
  ? 'Supabase is not configured. Add the project URL and publishable key to your local .env file.'
  : '';

export const supabase = configurationError
  ? null
  : createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });

export const formatMoney = (amount) => new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
}).format(Number(amount || 0));

export const showMessage = (element, message, isError = false) => {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('is-error', isError);
  element.classList.toggle('is-success', Boolean(message) && !isError);
};

export const getCurrentUser = async () => {
  if (!supabase) return { user: null, error: configurationError };
  const { data, error } = await supabase.auth.getUser();
  return { user: data.user, error };
};
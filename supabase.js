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
  const text = String(message || '');
  const missingHeartbeatMigration = /(?:column\s+["']?(?:public\.)?live_sessions\.last_heartbeat_at["']?\s+does not exist|admin_heartbeat_live_session.*(?:does not exist|schema cache|PGRST202))/i.test(text);
  const missingSchema = /PGRST205|could not find the table|schema cache/i.test(text);
  element.textContent = missingHeartbeatMigration
    ? 'Live-session disconnect protection is not installed in Supabase. Apply supabase/migrations/202610120004_live_session_disconnect_pause.sql in the Supabase SQL Editor, then reload this page.'
    : missingSchema
    ? 'Connected to Supabase, but the Game Nation database is not installed yet. Run the SQL migrations in supabase/migrations/ in order, then reload this page.'
    : text;
  element.classList.toggle('is-error', isError);
  element.classList.toggle('is-success', Boolean(text) && !isError);
};

export const getCurrentUser = async () => {
  if (!supabase) return { user: null, error: configurationError };
  const { data, error } = await supabase.auth.getUser();
  if (error?.name === 'AuthSessionMissingError') return { user: null, error: null };
  return { user: data.user, error };
};
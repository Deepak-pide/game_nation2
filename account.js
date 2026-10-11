import { configurationError, getCurrentUser, showMessage, supabase } from './supabase.js';

const authForm = document.getElementById('authForm');
const resetForm = document.getElementById('resetForm');
const nameField = document.getElementById('nameField');
const accountTitle = document.getElementById('accountTitle');
const accountFeedback = document.getElementById('accountFeedback');
const authSubmit = document.getElementById('authSubmit');
const switchAuth = document.getElementById('switchAuth');
const forgotPassword = document.getElementById('forgotPassword');
let authMode = 'signin';
let authSubmitting = false;

const setBusy = (button, busy, idleText) => {
  button.disabled = busy;
  button.textContent = busy ? 'Please wait…' : idleText;
};

const setAuthMode = (mode) => {
  authMode = mode;
  const registering = mode === 'signup';
  accountTitle.textContent = registering ? 'Create your Game ID' : 'Sign in to play';
  nameField.hidden = !registering;
  nameField.querySelector('input').required = registering;
  authForm.elements.password.autocomplete = registering ? 'new-password' : 'current-password';
  setBusy(authSubmit, false, registering ? 'Create account' : 'Sign in');
  switchAuth.textContent = registering ? 'Already a member? Sign in' : 'Create an account';
  forgotPassword.hidden = registering;
  showMessage(accountFeedback, '');
};

const redirectSignedInUser = async () => {
  if (new URLSearchParams(window.location.search).has('reset')) return;
  const { user } = await getCurrentUser();
  if (user) window.location.replace('dashboard.html');
};

switchAuth.addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (authSubmitting) return;
  if (!supabase) return showMessage(accountFeedback, configurationError, true);
  const form = new FormData(authForm);
  const email = String(form.get('email')).trim();
  const password = String(form.get('password'));
  const fullName = String(form.get('full_name') || '').trim();
  if (authMode === 'signup' && !fullName) {
    return showMessage(accountFeedback, 'Enter your full name to create an account.', true);
  }
  if (password.length < 8) {
    return showMessage(accountFeedback, 'Password must be at least 8 characters.', true);
  }

  authSubmitting = true;
  setBusy(authSubmit, true, '');
  try {
    const registering = authMode === 'signup';
    const result = registering
      ? await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: new URL('account.html', window.location.href).toString(),
        },
      })
      : await supabase.auth.signInWithPassword({ email, password });

    if (result.error) throw result.error;
    if (registering && !result.data.user) {
      throw new Error('Supabase did not return an account. Please try again.');
    }

    if (registering && !result.data.session) {
      showMessage(accountFeedback, 'Supabase did not start a session. To skip email confirmation, disable “Confirm email” in Supabase Authentication settings, then try again.', true);
      return;
    }

    showMessage(accountFeedback, registering ? 'Account created. Opening your dashboard…' : 'Signed in. Opening your dashboard…');
    window.location.assign('dashboard.html');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration could not be completed. Please try again.';
    showMessage(accountFeedback, message, true);
  } finally {
    authSubmitting = false;
    setBusy(authSubmit, false, authMode === 'signup' ? 'Create account' : 'Sign in');
  }
});

forgotPassword.addEventListener('click', async () => {
  if (!supabase) return showMessage(accountFeedback, configurationError, true);
  const email = authForm.elements.email.value.trim();
  if (!email) return showMessage(accountFeedback, 'Enter your email address first.', true);
  const redirectUrl = new URL('account.html?reset=1', window.location.href).toString();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectUrl,
  });
  showMessage(accountFeedback, error ? error.message : 'If that account exists, a password reset link is on its way.', Boolean(error));
});

resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!supabase) return showMessage(accountFeedback, configurationError, true);
  const password = new FormData(resetForm).get('password');
  const { error } = await supabase.auth.updateUser({ password: String(password) });
  if (error) return showMessage(accountFeedback, error.message, true);
  showMessage(accountFeedback, 'Password updated. You can now continue to your dashboard.');
  window.setTimeout(() => window.location.assign('dashboard.html'), 900);
});

if (new URLSearchParams(window.location.search).has('reset')) {
  authForm.hidden = true;
  document.querySelector('.account-links').hidden = true;
  resetForm.hidden = false;
  accountTitle.textContent = 'Choose a new password';
}
setAuthMode('signin');
if (configurationError) showMessage(accountFeedback, configurationError, true);
redirectSignedInUser();
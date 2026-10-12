import { showMessage } from './supabase.js';
import { initializeAdminPage } from './admin-shared.js';

const feedback = document.getElementById('adminFeedback');
const slotsContainer = document.getElementById('liveSlotList');
const empty = document.getElementById('liveSlotsEmpty');
const sessionDialog = document.getElementById('liveSessionDialog');
const dialogActions = document.getElementById('liveDialogActions');
const headerToggle = document.getElementById('liveHeaderToggle');
const headerPasswordDialog = document.getElementById('liveHeaderPasswordDialog');
const headerPasswordForm = document.getElementById('liveHeaderPasswordForm');
const headerPasswordInput = document.getElementById('liveHeaderPassword');
const headerPasswordFeedback = document.getElementById('liveHeaderPasswordFeedback');
const headerPasswordSubmit = headerPasswordForm.querySelector('[type="submit"]');
let client;
let clockInterval;
let syncInterval;
let isSyncing = false;
let selectedSessionDetails = null;
let connectionUnavailable = !navigator.onLine;
let connectionInterrupted = !navigator.onLine || sessionStorage.getItem('liveSessionConnectionInterrupted') === 'true';

const formatDateTime = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const formatElapsed = (seconds) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':');
};
const quickBookingDurationSeconds = 40 * 60;
const formatCountdown = (seconds) => {
  const total = Math.ceil(seconds);
  const sign = total < 0 ? '-' : '';
  const absolute = Math.abs(total);
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `${sign}${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};
const makeNode = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
};
const sessionSeconds = (session) => Number(session.accumulated_seconds)
  + (session.status === 'running' && session.started_at
    ? Math.max(0, ((connectionUnavailable && session.last_heartbeat_at
      ? new Date(session.last_heartbeat_at).getTime()
      : Date.now()) - new Date(session.started_at).getTime()) / 1000)
    : 0);

const updateClocks = () => {
  slotsContainer.querySelectorAll('[data-live-clock]').forEach((clock) => {
    const card = clock.closest('[data-session-id]');
    const session = card?.sessionData;
    if (session) clock.textContent = formatElapsed(sessionSeconds(session));
  });
  slotsContainer.querySelectorAll('[data-quick-clock]').forEach((clock) => {
    const card = clock.closest('[data-quick-session]');
    const session = card?.quickSessionData;
    if (!card) return;
    const remainingSeconds = quickBookingDurationSeconds - (session ? sessionSeconds(session) : 0);
    clock.textContent = formatCountdown(remainingSeconds);
    clock.closest('.live-quick-timer')?.classList.toggle('is-overdue', remainingSeconds <= 0);
    const state = card.querySelector('[data-quick-state]');
    if (state) {
      state.textContent = session?.status === 'running' && remainingSeconds <= 0
        ? 'OVERTIME'
        : session?.status.toUpperCase() || 'READY';
    }
  });
  if (selectedSessionDetails?.session) {
    document.getElementById('liveDialogClock').textContent = formatElapsed(sessionSeconds(selectedSessionDetails.session));
  }
};

const runAction = async (sessionId, action) => {
  showMessage(feedback, action === 'stop' ? 'Stopping session and finalizing its charge…' : 'Updating live session…');
  const { data, error } = await client.rpc('admin_update_live_session', {
    p_session_id: sessionId,
    p_action: action,
  });
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  const session = Array.isArray(data) ? data[0] : data;
  showMessage(feedback, action === 'stop'
    ? `Session stopped. ${session.charged_minutes} complete minute(s) deducted.`
    : action === 'pause'
      ? `Session paused at ${session.charged_minutes} billed minute(s).`
      : action === 'resume'
        ? 'Session resumed.'
        : '');
  await loadSlots();
};

const runQuickBookingTimerAction = async (quickBookingId, action) => {
  const actionLabels = {
    start: 'Starting Quick Book timer…',
    pause: 'Pausing Quick Book timer…',
    resume: 'Resuming Quick Book timer…',
    stop: 'Stopping Quick Book timer…',
  };
  showMessage(feedback, actionLabels[action]);
  const { error } = await client.rpc('admin_update_quick_booking_session', {
    p_quick_booking_id: quickBookingId,
    p_action: action,
  });
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  showMessage(feedback, action === 'start'
    ? 'Quick Book timer started.'
    : action === 'pause'
      ? 'Quick Book timer paused.'
      : action === 'resume'
        ? 'Quick Book timer resumed.'
        : 'Quick Book timer stopped.');
  await loadSlots();
};

const appendFacts = (target, values) => {
  target.replaceChildren();
  values.forEach(([label, value]) => {
    const item = makeNode('div');
    item.append(makeNode('dt', '', label), makeNode('dd', '', value));
    target.append(item);
  });
};

const addDialogAction = (label, className, callback, confirmMessage = '') => {
  const button = makeNode('button', `table-action ${className || ''}`.trim(), label);
  button.type = 'button';
  button.addEventListener('click', async () => {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    button.disabled = true;
    try {
      await callback();
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  dialogActions.append(button);
};

const renderSessionDialog = (details) => {
  selectedSessionDetails = details;
  const { booking, session, wallet, slot } = details;
  document.getElementById('liveDialogTitle').textContent = booking.profile?.full_name || 'Player';
  document.getElementById('liveDialogSubtitle').textContent =
    `${slot.console?.name || 'Console'} · ${formatDateTime(slot.starts_at)} – ${formatDateTime(slot.ends_at)}`;

  appendFacts(document.getElementById('liveDialogPlayerFacts'), [
    ['Game ID', booking.profile?.game_id || '—'],
    ['Gamer name', booking.profile?.full_name || 'Player'],
    ['Phone', booking.profile?.phone || '—'],
    ['Booking status', booking.status.replaceAll('_', ' ')],
    ['Console', slot.console?.name || 'Console'],
    ['Slot time', `${formatDateTime(slot.starts_at)} – ${formatDateTime(slot.ends_at)}`],
  ]);

  const tags = document.getElementById('liveDialogTags');
  tags.replaceChildren();
  const gamerTags = Array.isArray(booking.profile?.game_tags) ? booking.profile.game_tags : [];
  if (gamerTags.length) {
    gamerTags.forEach((tag) => tags.append(makeNode('span', 'live-dialog-tag', tag.replaceAll('-', ' '))));
  } else {
    tags.append(makeNode('span', 'live-dialog-no-tags', 'No game tags added'));
  }

  const timerPanel = document.getElementById('liveDialogTimerPanel');
  timerPanel.className = `live-dialog-timer-panel${session ? ` status-${session.status}` : ''}`;
  document.getElementById('liveDialogSessionState').textContent = session
    ? session.status === 'running' ? 'LIVE NOW' : session.status.toUpperCase()
    : 'READY TO START';
  document.getElementById('liveDialogClock').textContent = session ? formatElapsed(sessionSeconds(session)) : '00:00:00';
  document.getElementById('liveDialogBilled').textContent = session
    ? `${Math.floor(sessionSeconds(session) / 60)} min used`
    : 'No time used yet';

  const availableMinutes = wallet ? Math.max(0, Number(wallet.available_minutes)) : 0;
  appendFacts(document.getElementById('liveDialogCreditFacts'), [
    ['Available playtime', wallet ? `${Math.floor(availableMinutes / 60)} hr ${availableMinutes % 60} min` : 'Unavailable'],
    ['Completed minutes', session ? `${session.charged_minutes} min` : '0 min'],
  ]);

  dialogActions.replaceChildren();
  if (booking.status === 'approved' && !session && wallet && availableMinutes > 0) {
    addDialogAction('Start timer', 'live-start-action', async () => {
      showMessage(feedback, 'Starting live session…');
      const { error } = await client.rpc('admin_start_live_session', { p_booking_id: booking.id });
      if (error) {
        showMessage(feedback, error.message, true);
        await loadSlots();
        return;
      }
      showMessage(feedback, 'Session started. Billing advances in complete minutes.');
      await loadSlots();
    });
  } else if (session && session.status !== 'stopped') {
    if (session.status === 'running') {
      addDialogAction('Pause timer', '', () => runAction(session.id, 'pause'));
    } else if (availableMinutes > 0) {
      addDialogAction('Resume timer', 'live-start-action', () => runAction(session.id, 'resume'));
    } else {
      dialogActions.append(makeNode('span', 'live-slot-hint', 'Add player playtime before resuming this timer.'));
    }
    addDialogAction(
      'Stop session',
      'is-danger',
      () => runAction(session.id, 'stop'),
      'Stop this session? Only complete minutes will be charged.',
    );
  } else if (!wallet) {
    dialogActions.append(makeNode('span', 'live-slot-hint', 'Player playtime is unavailable.'));
  } else if (!availableMinutes && !session) {
    dialogActions.append(makeNode('span', 'live-slot-hint', 'Add player playtime before starting this timer.'));
  } else if (session?.status === 'stopped') {
    dialogActions.append(makeNode('span', 'live-slot-hint', 'This session timer has stopped.'));
  }
};

const renderSlots = ({ slots, bookings, sessions, wallets, quickBookings, quickSessions }) => {
  slotsContainer.replaceChildren();
  const activeSessions = new Map(sessions.map((session) => [session.booking_id, session]));
  const walletByGamer = new Map(wallets.map((wallet) => [wallet.user_id, wallet]));
  const eligibleBookings = bookings.filter((booking) => booking.status === 'approved');
  const visibleBookings = new Set();

  for (const slot of slots) {
    const booking = eligibleBookings.find((candidate) =>
      candidate.console_id === slot.console_id
      && new Date(candidate.starts_at).getTime() < new Date(slot.ends_at).getTime()
      && new Date(candidate.ends_at).getTime() > new Date(slot.starts_at).getTime());
    if (!booking || visibleBookings.has(booking.id)) continue;
    visibleBookings.add(booking.id);
    const session = activeSessions.get(booking.id) || null;
    const wallet = walletByGamer.get(booking.user_id) || null;
    const details = { booking, session, wallet, slot };
    const card = makeNode('article', `live-slot-card${session?.status === 'running' ? ' is-session-running' : ''}`);
    const openButton = makeNode('button', 'live-slot-open');
    openButton.type = 'button';
    openButton.setAttribute('aria-label', `Open session details for ${booking.profile?.full_name || booking.profile?.game_id || 'gamer'}`);
    openButton.append(
      makeNode('div', 'live-slot-card-topline', `${slot.console?.name || 'Console'} · APPROVED`),
      makeNode('h2', '', booking.profile?.full_name || booking.profile?.game_id || 'Player'),
    );
    const summary = makeNode('div', 'live-slot-summary');
    summary.append(
      makeNode('span', '', booking.profile?.game_id || 'No game ID'),
      makeNode('span', '', formatDateTime(slot.starts_at)),
      makeNode('span', `live-slot-status${session ? ` is-${session.status}` : ''}`, session?.status === 'running' ? 'LIVE' : session?.status === 'paused' ? 'PAUSED' : 'Ready to start'),
    );
    openButton.append(summary, makeNode('span', 'live-slot-open-hint', 'Tap to view gamer, playtime & timer →'));
    openButton.addEventListener('click', () => {
      renderSessionDialog(details);
      if (!sessionDialog.open) sessionDialog.showModal();
    });
    card.append(openButton);
    slotsContainer.append(card);
  }
  for (const quickBooking of quickBookings) {
    const slot = quickBooking.slot;
    if (!slot) continue;
    const card = makeNode('article', 'live-slot-card is-quick-booking');
    const quickSession = quickSessions.get(quickBooking.id) || null;
    card.dataset.quickSession = '';
    card.quickSessionData = quickSession;
    if (quickSession) card.classList.add(`is-quick-session-${quickSession.status}`);
    card.append(
      makeNode('div', 'live-slot-card-topline', `${slot.console?.name || 'Console'} · QUICK BOOKED`),
      makeNode('h2', '', quickBooking.name),
      makeNode('div', 'live-slot-summary', `${formatDateTime(slot.starts_at)} – ${formatDateTime(slot.ends_at)}`),
    );
    const meta = makeNode('div', 'live-quick-booking-meta');
    const state = makeNode('strong', '', quickSession ? quickSession.status.toUpperCase() : 'READY');
    state.dataset.quickState = '';
    meta.append(state);
    meta.append(makeNode('span', '', `${quickBooking.players} ${quickBooking.players === 1 ? 'player' : 'players'} · ₹${quickBooking.total_price}`));
    card.append(meta);
    const timer = makeNode('div', `live-quick-timer${quickSession ? ` status-${quickSession.status}` : ''}`);
    timer.append(makeNode('span', 'live-quick-timer-label', '40 MIN COUNTDOWN'));
    const clock = makeNode('strong', 'live-quick-clock', formatCountdown(
      quickBookingDurationSeconds - (quickSession ? sessionSeconds(quickSession) : 0),
    ));
    clock.dataset.quickClock = '';
    timer.append(clock);
    card.append(timer);

    const actions = makeNode('div', 'live-quick-actions');
    const addQuickAction = (label, action, className = '', confirmMessage = '') => {
      const button = makeNode('button', `table-action ${className}`.trim(), label);
      button.type = 'button';
      button.addEventListener('click', async () => {
        if (confirmMessage && !window.confirm(confirmMessage)) return;
        button.disabled = true;
        try {
          await runQuickBookingTimerAction(quickBooking.id, action);
        } finally {
          if (button.isConnected) button.disabled = false;
        }
      });
      actions.append(button);
    };
    if (!quickSession) {
      addQuickAction('Start timer', 'start', 'live-start-action');
    } else if (quickSession.status === 'running') {
      addQuickAction('Pause timer', 'pause');
      addQuickAction('Stop timer', 'stop', 'is-danger', 'Stop this Quick Book timer? This cannot be resumed.');
    } else if (quickSession.status === 'paused') {
      addQuickAction('Resume timer', 'resume', 'live-start-action');
      addQuickAction('Stop timer', 'stop', 'is-danger', 'Stop this Quick Book timer? This cannot be resumed.');
    }
    if (actions.childElementCount) card.append(actions);
    slotsContainer.append(card);
  }
  empty.hidden = visibleBookings.size + quickBookings.length > 0;
  if (selectedSessionDetails) {
    const refreshed = [...visibleBookings].includes(selectedSessionDetails.booking.id)
      ? Array.from(slots).find((slot) =>
        slot.console_id === selectedSessionDetails.booking.console_id
        && new Date(selectedSessionDetails.booking.starts_at).getTime() < new Date(slot.ends_at).getTime()
        && new Date(selectedSessionDetails.booking.ends_at).getTime() > new Date(slot.starts_at).getTime())
      : null;
    if (refreshed) {
      const booking = bookings.find((candidate) => candidate.id === selectedSessionDetails.booking.id);
      if (booking) {
        renderSessionDialog({
          booking,
          session: activeSessions.get(booking.id) || null,
          wallet: walletByGamer.get(booking.user_id) || null,
          slot: refreshed,
        });
      }
    } else if (sessionDialog.open) {
      sessionDialog.close();
      selectedSessionDetails = null;
    }
  }
  updateClocks();
};

const loadSlots = async () => {
  const [slotsResult, bookingsResult, sessionsResult, walletsResult, quickBookingsResult, quickSessionsResult] = await Promise.all([
    client.from('availability_slots').select('id,console_id,starts_at,ends_at,available,console:consoles(name)').order('starts_at'),
    client.from('bookings').select('id,user_id,console_id,starts_at,ends_at,status,profile:profiles!bookings_user_id_fkey(full_name,game_id,phone,game_tags)').order('starts_at'),
    client.from('live_sessions').select('id,booking_id,user_id,console_id,status,accumulated_seconds,charged_minutes,started_at,last_heartbeat_at,ended_at').order('created_at', { ascending: false }),
    client.rpc('get_admin_wallet_overview'),
    client.from('quick_bookings')
      .select('id,name,players,total_price,slot:availability_slots(starts_at,ends_at,console:consoles(name))')
      .order('created_at', { ascending: false }),
    client.from('quick_booking_sessions')
      .select('id,quick_booking_id,status,accumulated_seconds,started_at,ended_at')
      .order('created_at', { ascending: false }),
  ]);
  const failure = [slotsResult, bookingsResult, sessionsResult, walletsResult, quickBookingsResult, quickSessionsResult].find((result) => result.error);
  if (failure) {
    showMessage(feedback, failure.error.message, true);
    return;
  }
  renderSlots({
    slots: slotsResult.data,
    bookings: bookingsResult.data,
    sessions: sessionsResult.data,
    wallets: walletsResult.data,
    quickBookings: quickBookingsResult.data,
    quickSessions: new Map(quickSessionsResult.data.map((session) => [session.quick_booking_id, session])),
  });
  showMessage(feedback, '');
};

const syncRunningSessions = async () => {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const running = await client.from('live_sessions').select('id').eq('status', 'running');
    if (running.error) throw running.error;
    for (const session of running.data) {
      const heartbeat = await client.rpc('admin_heartbeat_live_session', {
        p_session_id: session.id,
        p_force_pause: connectionInterrupted,
      });
      if (heartbeat.error) throw heartbeat.error;
      const currentSession = Array.isArray(heartbeat.data) ? heartbeat.data[0] : heartbeat.data;
      if (currentSession?.status !== 'running') continue;
      const { error } = await client.rpc('admin_update_live_session', {
        p_session_id: session.id,
        p_action: 'sync',
      });
      if (error) throw error;
    }
    connectionUnavailable = false;
    connectionInterrupted = false;
    sessionStorage.removeItem('liveSessionConnectionInterrupted');
    if (running.data.length) await loadSlots();
  } catch (error) {
    connectionUnavailable = true;
    showMessage(feedback, error instanceof Error ? error.message : 'Could not synchronize live session charges.', true);
  } finally {
    isSyncing = false;
  }
};

const start = async () => {
  const admin = await initializeAdminPage();
  if (!admin) return;
  client = admin.supabase;
  const setHeaderHidden = (hidden) => {
    document.body.classList.toggle('live-header-hidden', hidden);
    headerToggle.setAttribute('aria-pressed', String(hidden));
    headerToggle.setAttribute('aria-label', hidden ? 'Show site header (admin password required)' : 'Hide site header');
    headerToggle.querySelector('.live-header-eye-open').hidden = hidden;
    headerToggle.querySelector('.live-header-eye-closed').hidden = !hidden;
    if (hidden) localStorage.setItem('adminLiveHeaderHidden', 'true');
    else localStorage.removeItem('adminLiveHeaderHidden');
  };
  setHeaderHidden(localStorage.getItem('adminLiveHeaderHidden') === 'true');
  headerToggle.addEventListener('click', () => {
    if (!document.body.classList.contains('live-header-hidden')) {
      setHeaderHidden(true);
      return;
    }
    headerPasswordInput.value = '';
    headerPasswordFeedback.textContent = '';
    headerPasswordDialog.showModal();
    headerPasswordInput.focus();
  });
  document.getElementById('cancelLiveHeaderPassword').addEventListener('click', () => headerPasswordDialog.close());
  headerPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!admin.user.email) {
      showMessage(headerPasswordFeedback, 'The signed-in admin account has no email address to verify.', true);
      return;
    }
    headerPasswordSubmit.disabled = true;
    showMessage(headerPasswordFeedback, 'Verifying admin password…');
    const { error } = await client.auth.signInWithPassword({
      email: admin.user.email,
      password: headerPasswordInput.value,
    });
    headerPasswordSubmit.disabled = false;
    if (error) {
      showMessage(headerPasswordFeedback, error.message, true);
      headerPasswordInput.focus();
      return;
    }
    headerPasswordDialog.close();
    setHeaderHidden(false);
  });
  window.addEventListener('offline', () => {
    connectionUnavailable = true;
    connectionInterrupted = true;
    sessionStorage.setItem('liveSessionConnectionInterrupted', 'true');
    showMessage(feedback, 'Connection lost. The timer display is held at its last saved heartbeat and will pause when the server is reachable again.', true);
    updateClocks();
  });
  window.addEventListener('online', () => {
    showMessage(feedback, 'Connection restored. Saving and checking session timers…');
    syncRunningSessions();
  });
  document.getElementById('closeLiveDialog').addEventListener('click', () => sessionDialog.close());
  sessionDialog.addEventListener('click', (event) => {
    if (event.target === sessionDialog) sessionDialog.close();
  });
  document.getElementById('refreshLiveSlots').addEventListener('click', loadSlots);
  await loadSlots();
  client.channel('admin-live-session-page')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'availability_slots' }, loadSlots)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, loadSlots)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions' }, loadSlots)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions' }, loadSlots)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quick_bookings' }, loadSlots)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quick_booking_sessions' }, loadSlots)
    .subscribe();
  clockInterval = window.setInterval(updateClocks, 1000);
  syncInterval = window.setInterval(syncRunningSessions, 15000);
};

window.addEventListener('pagehide', () => {
  window.clearInterval(clockInterval);
  window.clearInterval(syncInterval);
});

start().catch((error) => showMessage(feedback, error instanceof Error ? error.message : 'Could not load live slots.', true));

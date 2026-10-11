import { configurationError, formatMoney, getCurrentUser, showMessage, supabase } from './supabase.js';

const bookingDateInput = document.getElementById('bookingDate');
const consoleSelect = document.getElementById('consoleSelect');
const selectedDateLabel = document.getElementById('selectedDateLabel');
const slotGroups = document.getElementById('slotGroups');
const bookingFeedback = document.getElementById('bookingFeedback');

const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDateBounds = (dateValue) => {
  const start = new Date(`${dateValue}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
};

const formatDateLabel = (dateString) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    .format(new Date(year, month - 1, day, 12));
};

const formatTime = (dateString) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  .format(new Date(dateString));

const loadConsoles = async () => {
  const { data, error } = await supabase.from('consoles')
    .select('id,name,platform,hourly_rate').eq('active', true).order('name');
  if (error) throw error;
  consoleSelect.replaceChildren();
  for (const consoleItem of data) {
    const option = document.createElement('option');
    option.value = consoleItem.id;
    option.textContent = `${consoleItem.name} · ${formatMoney(consoleItem.hourly_rate)}/hr`;
    consoleSelect.append(option);
  }
  consoleSelect.disabled = !data.length;
};

const updateBooking = async (bookingId) => {
  showMessage(bookingFeedback, 'Updating your request…');
  const { error } = await supabase.rpc('cancel_own_booking', { p_booking_id: bookingId });
  if (error) showMessage(bookingFeedback, error.message, true);
  else showMessage(bookingFeedback, 'Booking request cancelled.');
  await renderSlots();
};

const renderSlot = (slot, booking, user) => {
  const confirmed = booking && ['approved', 'completed'].includes(booking.status);
  const pending = booking?.status === 'pending';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `slot-button${confirmed ? ' is-booked' : ''}${pending ? ' is-pending' : ''}`;
  button.disabled = !user || confirmed || (!booking && !slot.available);
  button.setAttribute('aria-label', `${formatTime(slot.starts_at)} to ${formatTime(slot.ends_at)}, ${confirmed ? 'confirmed' : pending ? 'request pending' : 'available'}`);

  const time = document.createElement('span');
  time.className = 'slot-time';
  time.textContent = `${formatTime(slot.starts_at)} – ${formatTime(slot.ends_at)}`;
  const state = document.createElement('span');
  state.className = 'slot-state';
  state.textContent = confirmed ? 'Confirmed' : pending ? 'Pending review' : slot.available ? 'Request slot' : 'Unavailable';
  button.append(time, state);

  if (pending && booking.user_id === user?.id) {
    button.disabled = false;
    button.addEventListener('click', () => updateBooking(booking.id));
  } else if (!booking && slot.available && user) {
    button.addEventListener('click', () => requestBooking(slot));
  }
  return button;
};

const renderSlots = async () => {
  if (!supabase || !consoleSelect.value || !bookingDateInput.value) return;
  bookingFeedback.textContent = 'Loading availability…';
  const { user, error: authError } = await getCurrentUser();
  if (authError) return showMessage(bookingFeedback, authError.message, true);
  const { start, end } = getDateBounds(bookingDateInput.value);
  const requests = [
    supabase.from('availability_slots').select('id,console_id,starts_at,ends_at,available')
      .eq('console_id', consoleSelect.value).gte('starts_at', start).lt('starts_at', end).order('starts_at'),
    supabase.rpc('confirmed_console_slots', {
      p_console_id: consoleSelect.value,
      p_starts_at: start,
      p_ends_at: end,
    }),
  ];
  if (user) {
    requests.push(supabase.from('bookings').select('id,user_id,console_id,starts_at,ends_at,status')
      .eq('console_id', consoleSelect.value).gte('starts_at', start).lt('starts_at', end));
  }
  const [slotsResult, confirmedResult, ownBookingsResult] = await Promise.all(requests);
  const failed = [slotsResult, confirmedResult, ownBookingsResult].find((result) => result?.error);
  if (failed) return showMessage(bookingFeedback, failed.error.message, true);

  selectedDateLabel.textContent = formatDateLabel(bookingDateInput.value);
  slotGroups.replaceChildren();
  const bookingsByStart = new Map();
  for (const booking of ownBookingsResult?.data || []) {
    if (!['pending', 'approved', 'completed'].includes(booking.status)) continue;
    const current = bookingsByStart.get(booking.starts_at);
    if (!current || ['approved', 'completed'].includes(booking.status)) bookingsByStart.set(booking.starts_at, booking);
  }
  for (const confirmed of confirmedResult.data) {
    const slot = slotsResult.data.find((candidate) => new Date(candidate.starts_at) < new Date(confirmed.ends_at)
      && new Date(candidate.ends_at) > new Date(confirmed.starts_at));
    if (slot && !bookingsByStart.has(slot.starts_at)) bookingsByStart.set(slot.starts_at, { status: 'approved' });
  }

  if (!slotsResult.data.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No sessions have been scheduled for this console and date yet.';
    slotGroups.append(empty);
  } else {
    for (const slot of slotsResult.data) {
      const section = document.createElement('section');
      section.className = 'slot-group';
      const heading = document.createElement('h2');
      heading.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(slot.starts_at));
      const grid = document.createElement('div');
      grid.className = 'slot-grid';
      grid.append(renderSlot(slot, bookingsByStart.get(slot.starts_at), user));
      section.append(heading, grid);
      slotGroups.append(section);
    }
  }

  if (!user) {
    const signIn = document.createElement('a');
    signIn.className = 'nav-pill status-signin';
    signIn.href = 'account.html';
    signIn.textContent = 'Sign in to request a session';
    slotGroups.append(signIn);
  }
  showMessage(bookingFeedback, '');
};

async function requestBooking(slot) {
  showMessage(bookingFeedback, 'Sending your request…');
  const { error } = await supabase.from('bookings').insert({
    console_id: slot.console_id,
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
  });
  if (error) showMessage(bookingFeedback, error.message, true);
  else showMessage(bookingFeedback, 'Request sent. It will be reserved after admin approval.');
  await renderSlots();
}

bookingDateInput.value = getLocalDateString();
bookingDateInput.min = getLocalDateString();
bookingDateInput.addEventListener('change', renderSlots);
consoleSelect.addEventListener('change', renderSlots);

if (configurationError) {
  showMessage(bookingFeedback, configurationError, true);
  slotGroups.innerHTML = '<p class="empty-state">Connect this site to Supabase to load console availability.</p>';
} else {
  loadConsoles().then(renderSlots).catch((error) => showMessage(bookingFeedback, error.message, true));
  supabase.channel('public-bookings').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, renderSlots).subscribe();
  window.setInterval(() => {
    if (document.visibilityState === 'visible') renderSlots();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderSlots();
  });
}
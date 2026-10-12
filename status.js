import { configurationError, getCurrentUser, showMessage, supabase } from './supabase.js';

const bookingDateInput = document.getElementById('bookingDate');
const consoleSelect = document.getElementById('consoleSelect');
const selectedDateLabel = document.getElementById('selectedDateLabel');
const slotGroups = document.getElementById('slotGroups');
const bookingFeedback = document.getElementById('bookingFeedback');
const bookingConfirmDialog = document.getElementById('bookingConfirmDialog');
const bookingConfirmTitle = document.getElementById('bookingConfirmTitle');
const bookingConfirmDetails = document.getElementById('bookingConfirmDetails');
const bookingConfirmYes = document.getElementById('bookingConfirmYes');
const bookingConfirmNo = document.getElementById('bookingConfirmNo');
const quickBookDialog = document.getElementById('quickBookDialog');
const quickBookForm = document.getElementById('quickBookForm');
const quickBookFeedback = document.getElementById('quickBookFeedback');
const quickBookSubmit = quickBookForm.querySelector('[type="submit"]');
let pendingConfirmation;
let selectedQuickSlot;
let bookingNotice = '';

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
    .select('id,name,platform').eq('active', true).order('name');
  if (error) throw error;
  consoleSelect.replaceChildren();
  for (const consoleItem of data) {
    const option = document.createElement('option');
    option.value = consoleItem.id;
    option.textContent = consoleItem.name;
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
  const quickBooked = booking?.status === 'quick_booked';
  const pending = booking?.status === 'pending';
  const isPast = new Date(slot.starts_at).getTime() <= Date.now();
  const choices = document.createElement('div');
  choices.className = 'slot-choices';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `slot-button${confirmed || quickBooked ? ' is-booked' : ''}${pending ? ' is-pending' : ''}${isPast && !pending ? ' is-past' : ''}`;
  button.disabled = !user || confirmed || quickBooked || (!pending && isPast) || (!booking && !slot.available);
  button.setAttribute('aria-label', `${formatTime(slot.starts_at)}, ${quickBooked ? 'quick booked' : confirmed ? 'confirmed' : pending ? 'request pending' : isPast ? 'time has passed' : slot.available ? 'available' : 'unavailable'}`);

  const time = document.createElement('span');
  time.className = 'slot-time';
  time.textContent = formatTime(slot.starts_at);
  const state = document.createElement('span');
  state.className = 'slot-state';
  state.textContent = quickBooked ? 'Quick booked' : confirmed ? 'Confirmed' : pending ? 'Pending approval' : isPast ? 'Time passed' : slot.available ? 'Request slot' : 'Unavailable';
  button.append(time, state);

  if (pending && booking.user_id === user?.id) {
    button.disabled = false;
    button.addEventListener('click', () => confirmSelection(slot, 'cancel', booking));
  } else if (!booking && slot.available && user) {
    button.addEventListener('click', () => confirmSelection(slot, 'book'));
  }
  choices.append(button);
  if (!booking && slot.available && !isPast) {
    const quickBookButton = document.createElement('button');
    quickBookButton.type = 'button';
    quickBookButton.className = 'quick-book-slot-button';
    quickBookButton.textContent = 'Quick Book';
    quickBookButton.setAttribute('aria-label', `Quick book ${formatTime(slot.starts_at)}`);
    quickBookButton.addEventListener('click', () => {
      selectedQuickSlot = slot;
      document.getElementById('quickBookDetails').textContent =
        `${consoleSelect.selectedOptions[0]?.textContent || 'Selected console'} · ${formatDateLabel(bookingDateInput.value)} · ${formatTime(slot.starts_at)} to ${formatTime(slot.ends_at)}`;
      quickBookFeedback.textContent = '';
      quickBookForm.elements.name.value = '';
      quickBookForm.elements.players.value = '1';
      quickBookDialog.showModal();
      quickBookForm.elements.name.focus();
    });
    choices.append(quickBookButton);
  }
  return choices;
};

const confirmSelection = (slot, action, booking = null) => {
  pendingConfirmation = { slot, action, booking };
  bookingConfirmTitle.textContent = action === 'book'
    ? 'Do you want to book this session?'
    : 'Do you want to cancel this request?';
  bookingConfirmDetails.textContent = `${consoleSelect.selectedOptions[0]?.textContent || 'Selected console'} · ${formatDateLabel(bookingDateInput.value)} · ${formatTime(slot.starts_at)} to ${formatTime(slot.ends_at)}`;
  bookingConfirmYes.textContent = action === 'book' ? 'Yes, book it' : 'Yes, cancel it';
  bookingConfirmDialog.showModal();
};

bookingConfirmNo.addEventListener('click', () => bookingConfirmDialog.close());
bookingConfirmDialog.addEventListener('close', () => {
  pendingConfirmation = null;
  bookingConfirmYes.disabled = false;
});
bookingConfirmYes.addEventListener('click', async () => {
  if (!pendingConfirmation) return;
  const { slot, action, booking } = pendingConfirmation;
  bookingConfirmYes.disabled = true;
  bookingConfirmDialog.close();
  if (action === 'book') await requestBooking(slot);
  else await updateBooking(booking.id);
});

document.getElementById('quickBookCancel').addEventListener('click', () => quickBookDialog.close());
quickBookDialog.addEventListener('close', () => {
  selectedQuickSlot = null;
  quickBookSubmit.disabled = false;
});
quickBookForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedQuickSlot) return;
  const name = quickBookForm.elements.name.value.trim();
  if (!name) {
    showMessage(quickBookFeedback, 'Enter your name to book this slot.', true);
    return;
  }
  quickBookSubmit.disabled = true;
  showMessage(quickBookFeedback, 'Saving your quick booking…');
  const { error } = await supabase.rpc('create_quick_booking', {
    p_slot_id: selectedQuickSlot.id,
    p_name: name,
    p_players: Number(quickBookForm.elements.players.value),
  });
  if (error) {
    showMessage(quickBookFeedback, error.message, true);
    quickBookSubmit.disabled = false;
    return;
  }
  const selectedTime = formatTime(selectedQuickSlot.starts_at);
  quickBookDialog.close();
  bookingNotice = `Quick booking saved for ${name} at ${selectedTime}. No admin confirmation is needed.`;
  await renderSlots();
  showMessage(bookingFeedback, bookingNotice);
});

const renderSlots = async (newRequest = null) => {
  if (!supabase || !consoleSelect.value || !bookingDateInput.value) return false;
  if (!bookingNotice) bookingFeedback.textContent = 'Loading availability…';
  const { user, error: authError } = await getCurrentUser();
  if (authError) {
    showMessage(bookingFeedback, authError.message, true);
    return false;
  }
  const { start, end } = getDateBounds(bookingDateInput.value);
  const requests = [
    supabase.from('availability_slots').select('id,console_id,starts_at,ends_at,available')
      .eq('console_id', consoleSelect.value).gte('starts_at', start).lt('starts_at', end).order('starts_at'),
    supabase.rpc('confirmed_console_slots', {
      p_console_id: consoleSelect.value,
      p_starts_at: start,
      p_ends_at: end,
    }),
    supabase.rpc('quick_booked_console_slots', {
      p_console_id: consoleSelect.value,
      p_starts_at: start,
      p_ends_at: end,
    }),
  ];
  if (user) {
    requests.push(supabase.from('bookings').select('id,user_id,console_id,starts_at,ends_at,status')
      .eq('console_id', consoleSelect.value).gte('starts_at', start).lt('starts_at', end));
  }
  const [slotsResult, confirmedResult, quickBookedResult, ownBookingsResult] = await Promise.all(requests);
  const failed = [slotsResult, confirmedResult, ownBookingsResult].find((result) => result?.error);
  if (failed) {
    showMessage(bookingFeedback, failed.error.message, true);
    return false;
  }

  selectedDateLabel.textContent = formatDateLabel(bookingDateInput.value);
  slotGroups.replaceChildren();
  const bookingsByStart = new Map();
  for (const booking of ownBookingsResult?.data || []) {
    if (!['pending', 'approved', 'completed'].includes(booking.status)) continue;
    const current = bookingsByStart.get(booking.starts_at);
    if (!current || ['approved', 'completed'].includes(booking.status)) bookingsByStart.set(booking.starts_at, booking);
  }
  if (newRequest?.status === 'pending') {
    bookingsByStart.set(newRequest.starts_at, newRequest);
  }
  for (const confirmed of confirmedResult.data) {
    const slot = slotsResult.data.find((candidate) => new Date(candidate.starts_at) < new Date(confirmed.ends_at)
      && new Date(candidate.ends_at) > new Date(confirmed.starts_at));
    if (slot && !bookingsByStart.has(slot.starts_at)) bookingsByStart.set(slot.starts_at, { status: 'approved' });
  }
  for (const quickBooking of quickBookedResult.data) {
    const slot = slotsResult.data.find((candidate) => new Date(candidate.starts_at) < new Date(quickBooking.ends_at)
      && new Date(candidate.ends_at) > new Date(quickBooking.starts_at));
    if (slot) bookingsByStart.set(slot.starts_at, { status: 'quick_booked' });
  }

  if (!slotsResult.data.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No sessions have been scheduled for this console and date yet.';
    slotGroups.append(empty);
  } else {
    const section = document.createElement('section');
    section.className = 'slot-group';
    const heading = document.createElement('h2');
    heading.textContent = 'Available start times';
    const grid = document.createElement('div');
    grid.className = 'slot-grid';
    for (const slot of slotsResult.data) {
      grid.append(renderSlot(slot, bookingsByStart.get(slot.starts_at), user));
    }
    section.append(heading, grid);
    slotGroups.append(section);
  }

  if (!user) {
    const signIn = document.createElement('a');
    signIn.className = 'nav-pill status-signin';
    signIn.href = 'account.html';
    signIn.textContent = 'Sign in to request a session';
    slotGroups.append(signIn);
  }
  showMessage(bookingFeedback, bookingNotice);
  return true;
};

async function requestBooking(slot) {
  showMessage(bookingFeedback, 'Sending your request…');
  bookingNotice = '';
  try {
    const { data: booking, error } = await supabase.from('bookings').insert({
      console_id: slot.console_id,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
    }).select('id,user_id,console_id,starts_at,ends_at,status').single();
    if (error) {
      await renderSlots();
      const message = /past/i.test(error.message)
        ? 'That time has already passed. Choose a future slot.'
        : /signed-in gamer|admin/i.test(error.message)
          ? 'Sign in with a gamer account to request a booking.'
          : /not available|overlap|exclusion/i.test(error.message)
            ? 'That slot is no longer available. Please choose another time.'
            : /JWT|token|auth session|unauthorized/i.test(error.message)
              ? 'Your sign-in has expired. Sign in again, then retry your booking.'
              : error.message;
      showMessage(bookingFeedback, message, true);
      return;
    }
    if (booking.status !== 'pending') {
      await renderSlots();
      showMessage(bookingFeedback, 'The request was created but is not pending. Refresh the page or contact Game Nation.', true);
      return;
    }
    bookingNotice = 'Request sent successfully — Pending admin approval. This slot is not confirmed until approved.';
    const refreshed = await renderSlots(booking);
    showMessage(bookingFeedback, refreshed
      ? bookingNotice
      : `${bookingNotice} Reload the page if the slot does not update.`);
  } catch (error) {
    showMessage(bookingFeedback, error instanceof Error ? error.message : 'Could not send the booking request.', true);
  }
}

bookingDateInput.value = getLocalDateString();
bookingDateInput.min = getLocalDateString();
bookingDateInput.addEventListener('change', () => {
  bookingNotice = '';
  renderSlots();
});
consoleSelect.addEventListener('change', () => {
  bookingNotice = '';
  renderSlots();
});

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
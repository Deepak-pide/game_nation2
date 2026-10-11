import { configurationError, formatMoney, getCurrentUser, showMessage, supabase } from './supabase.js';

const feedback = document.getElementById('dashboardFeedback');
const gamerView = document.getElementById('gamerView');
const adminView = document.getElementById('adminView');
const dateToday = new Date();
const localDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const escapeText = (value) => String(value ?? '');
const makeCell = (text) => {
  const cell = document.createElement('td');
  cell.textContent = escapeText(text);
  return cell;
};
const formatDateTime = (value) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));
const startOfLocalDay = (value) => new Date(`${value}T00:00:00`);
const isWithin = (date, from, to) => date >= from && date < to;
const fetchAllRows = async (queryFactory) => {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await queryFactory().range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
    offset += 1000;
  }
};

document.getElementById('signOutButton').addEventListener('click', async () => {
  if (!supabase) return window.location.assign('account.html');
  const { error } = await supabase.auth.signOut();
  if (error) showMessage(feedback, error.message, true);
  else window.location.assign('account.html');
});

const showGamerDashboard = async (profile, user) => {
  gamerView.hidden = false;
  document.getElementById('dashboardTitle').textContent = `Welcome, ${profile.full_name || 'gamer'}`;
  document.getElementById('dashboardIntro').textContent = 'Your Game ID, session history, and account details.';
  let bookings;
  try {
    bookings = await fetchAllRows(() => supabase.from('bookings')
      .select('id,starts_at,ends_at,status,total_price,console:consoles(name)')
      .eq('user_id', user.id).order('starts_at', { ascending: false }));
  } catch (error) {
    return showMessage(feedback, error.message, true);
  }

  document.getElementById('gamerName').textContent = profile.full_name || 'Player';
  document.getElementById('gamerId').textContent = profile.game_id;
  document.getElementById('memberSince').textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(profile.created_at));
  document.getElementById('totalBookings').textContent = bookings.length;
  const completed = bookings.filter((booking) => booking.status === 'completed');
  document.getElementById('completedSessions').textContent = completed.length;
  document.getElementById('gamerSpending').textContent = formatMoney(completed.reduce((sum, booking) => sum + Number(booking.total_price), 0));

  const profileForm = document.getElementById('profileForm');
  profileForm.elements.full_name.value = profile.full_name || '';
  profileForm.elements.phone.value = profile.phone || '';
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { error: updateError } = await supabase.from('profiles').update({
      full_name: profileForm.elements.full_name.value.trim(),
      phone: profileForm.elements.phone.value.trim(),
    }).eq('id', user.id);
    showMessage(feedback, updateError ? updateError.message : 'Profile saved.', Boolean(updateError));
    if (!updateError) document.getElementById('gamerName').textContent = profileForm.elements.full_name.value.trim();
  });

  const rows = document.getElementById('gamerBookings');
  rows.replaceChildren();
  for (const booking of bookings) {
    const row = document.createElement('tr');
    row.append(makeCell(formatDateTime(booking.starts_at)), makeCell(booking.console?.name || 'Console'), makeCell(booking.status), makeCell(formatMoney(booking.total_price)));
    const actions = document.createElement('td');
    if (['pending', 'approved'].includes(booking.status)) {
      const cancel = document.createElement('button');
      cancel.className = 'table-action';
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', async () => {
        const { error: cancelError } = await supabase.rpc('cancel_own_booking', { p_booking_id: booking.id });
        showMessage(feedback, cancelError ? cancelError.message : 'Booking cancelled.', Boolean(cancelError));
        if (!cancelError) await showGamerDashboard(profile, user);
      });
      actions.append(cancel);
    }
    row.append(actions);
    rows.append(row);
  }
  document.getElementById('gamerBookingsEmpty').hidden = bookings.length > 0;
};

const loadAdminRecords = async () => {
  const [profiles, bookings, consoles, slots] = await Promise.all([
    fetchAllRows(() => supabase.from('profiles').select('id,game_id,full_name,email,phone,created_at,role').order('created_at', { ascending: false })),
    fetchAllRows(() => supabase.from('bookings').select('id,user_id,console_id,starts_at,ends_at,status,total_price,gamer_note,profile:profiles!bookings_user_id_fkey(id,game_id,full_name,email),console:consoles(name)').order('starts_at', { ascending: false })),
    fetchAllRows(() => supabase.from('consoles').select('id,name,platform,hourly_rate,active').order('name')),
    fetchAllRows(() => supabase.from('availability_slots').select('id,console_id,starts_at,ends_at,available,console:consoles(name)').order('starts_at')),
  ]);
  return { profiles, bookings, consoles, slots };
};

let adminRecords;

const renderAnalytics = () => {
  const from = startOfLocalDay(document.getElementById('analyticsFrom').value);
  const to = startOfLocalDay(document.getElementById('analyticsTo').value);
  to.setDate(to.getDate() + 1);
  const inRange = adminRecords.bookings.filter((booking) => isWithin(new Date(booking.starts_at), from, to));
  const confirmed = inRange.filter((booking) => ['approved', 'completed'].includes(booking.status));
  const completed = inRange.filter((booking) => booking.status === 'completed');
  const activeUserIds = new Set(inRange.filter((booking) => ['pending', 'approved', 'completed'].includes(booking.status)).map((booking) => booking.user_id));
  const capacityHours = adminRecords.slots.filter((slot) => slot.available && isWithin(new Date(slot.starts_at), from, to))
    .reduce((sum, slot) => sum + (new Date(slot.ends_at) - new Date(slot.starts_at)) / 3600000, 0);
  const bookedHours = confirmed.reduce((sum, booking) => sum + (new Date(booking.ends_at) - new Date(booking.starts_at)) / 3600000, 0);
  const topGamers = new Map();
  for (const booking of completed) {
    const name = booking.profile?.full_name || booking.profile?.game_id || 'Player';
    topGamers.set(name, (topGamers.get(name) || 0) + Number(booking.total_price));
  }
  const topGamer = [...topGamers].sort((first, second) => second[1] - first[1])[0];
  const todayStart = startOfLocalDay(localDate(dateToday));
  const monthStart = new Date(dateToday.getFullYear(), dateToday.getMonth(), 1);
  const completedAll = adminRecords.bookings.filter((booking) => booking.status === 'completed');
  const todayRevenue = completedAll.filter((booking) => isWithin(new Date(booking.starts_at), todayStart, new Date(todayStart.getTime() + 86400000)))
    .reduce((sum, booking) => sum + Number(booking.total_price), 0);
  const monthRevenue = completedAll.filter((booking) => isWithin(new Date(booking.starts_at), monthStart, new Date(dateToday.getFullYear(), dateToday.getMonth() + 1, 1)))
    .reduce((sum, booking) => sum + Number(booking.total_price), 0);
  const metrics = [
    ['Today revenue', formatMoney(todayRevenue)],
    ['Month revenue', formatMoney(monthRevenue)],
    ['Bookings in range', String(confirmed.length)],
    ['Completed sessions', String(completed.length)],
    ['Active gamers', String(activeUserIds.size)],
    ['Console utilization', `${capacityHours ? Math.round((bookedHours / capacityHours) * 100) : 0}%`],
    ['Top gamer · range', topGamer ? `${topGamer[0]} · ${formatMoney(topGamer[1])}` : '—'],
  ];
  const container = document.getElementById('analyticsMetrics');
  container.replaceChildren();
  for (const [label, value] of metrics) {
    const item = document.createElement('article');
    item.className = 'metric-item';
    const title = document.createElement('span');
    title.textContent = label;
    const number = document.createElement('strong');
    number.textContent = value;
    item.append(title, number);
    container.append(item);
  }
};

const renderAdminBookings = () => {
  const query = document.getElementById('bookingSearch').value.trim().toLowerCase();
  const status = document.getElementById('bookingStatusFilter').value;
  const date = document.getElementById('bookingDateFilter').value;
  const list = adminRecords.bookings.filter((booking) => {
    const searchTarget = [booking.profile?.game_id, booking.profile?.full_name, booking.profile?.email, booking.console?.name].join(' ').toLowerCase();
    return (!query || searchTarget.includes(query)) && (status === 'all' || booking.status === status)
      && (!date || localDate(new Date(booking.starts_at)) === date);
  });
  const body = document.getElementById('adminBookings');
  body.replaceChildren();
  for (const booking of list) {
    const row = document.createElement('tr');
    row.append(
      makeCell(`${booking.profile?.full_name || 'Player'} · ${booking.profile?.game_id || ''}`),
      makeCell(booking.console?.name || 'Console'),
      makeCell(`${formatDateTime(booking.starts_at)} – ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(booking.ends_at))}`),
      makeCell(booking.status),
      makeCell(formatMoney(booking.total_price)),
    );
    const actions = document.createElement('td');
    const allowed = booking.status === 'pending' ? ['approved', 'rejected'] : booking.status === 'approved' ? ['completed', 'cancelled'] : [];
    for (const nextStatus of allowed) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'table-action';
      action.textContent = nextStatus;
      action.addEventListener('click', () => setBookingStatus(booking.id, nextStatus));
      actions.append(action);
    }
    row.append(actions);
    body.append(row);
  }
  document.getElementById('adminBookingsEmpty').hidden = list.length > 0;
};

const renderAdminGamers = () => {
  const query = document.getElementById('gamerSearch').value.trim().toLowerCase();
  const list = adminRecords.profiles.filter((profile) => profile.role === 'gamer' && [profile.game_id, profile.full_name, profile.email].join(' ').toLowerCase().includes(query));
  const body = document.getElementById('adminGamers');
  body.replaceChildren();
  for (const profile of list) {
    const count = adminRecords.bookings.filter((booking) => booking.user_id === profile.id).length;
    const row = document.createElement('tr');
    row.append(makeCell(profile.game_id));
    const nameCell = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.className = 'table-cell-input';
    nameInput.value = profile.full_name || '';
    nameInput.maxLength = 80;
    nameInput.setAttribute('aria-label', `Name for ${profile.game_id}`);
    nameCell.append(nameInput);
    row.append(nameCell, makeCell(profile.email || '—'));
    const phoneCell = document.createElement('td');
    const phoneInput = document.createElement('input');
    phoneInput.className = 'table-cell-input';
    phoneInput.value = profile.phone || '';
    phoneInput.maxLength = 30;
    phoneInput.setAttribute('aria-label', `Phone for ${profile.game_id}`);
    phoneCell.append(phoneInput);
    row.append(phoneCell, makeCell(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(profile.created_at))), makeCell(count));
    const actions = document.createElement('td');
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'table-action';
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      const { error } = await supabase.from('profiles').update({
        full_name: nameInput.value.trim(),
        phone: phoneInput.value.trim(),
      }).eq('id', profile.id);
      showMessage(feedback, error ? error.message : 'Gamer record updated.', Boolean(error));
      if (!error) await refreshAdmin();
    });
    actions.append(save);
    row.append(actions);
    body.append(row);
  }
  document.getElementById('adminGamersEmpty').hidden = list.length > 0;
};

const renderConsoles = () => {
  const list = document.getElementById('consoleList');
  list.replaceChildren();
  for (const consoleItem of adminRecords.consoles) {
    const row = document.createElement('form');
    row.className = 'console-row';
    row.innerHTML = `<label class="form-field">Name<input name="name" required maxlength="80" value="${escapeText(consoleItem.name).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}" /></label><label class="form-field">Platform<input name="platform" required maxlength="80" value="${escapeText(consoleItem.platform).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}" /></label><label class="form-field">Rate (₹/hr)<input name="hourly_rate" type="number" min="0" step="0.01" required value="${Number(consoleItem.hourly_rate)}" /></label>`;
    const active = document.createElement('label');
    active.className = 'checkbox-field';
    const checkbox = document.createElement('input');
    checkbox.name = 'active';
    checkbox.type = 'checkbox';
    checkbox.checked = consoleItem.active;
    active.append(checkbox, document.createTextNode('Active'));
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'table-action';
    save.textContent = 'Save';
    row.append(active, save);
    row.addEventListener('submit', async (event) => {
      event.preventDefault();
      const update = {
        name: row.elements.name.value.trim(),
        platform: row.elements.platform.value.trim(),
        hourly_rate: Number(row.elements.hourly_rate.value),
        active: row.elements.active.checked,
      };
      const { error } = await supabase.from('consoles').update(update).eq('id', consoleItem.id);
      showMessage(feedback, error ? error.message : 'Console updated.', Boolean(error));
      if (!error) await refreshAdmin();
    });
    list.append(row);
  }
  const select = document.getElementById('availabilityConsole');
  select.replaceChildren();
  for (const consoleItem of adminRecords.consoles.filter((item) => item.active)) {
    const option = document.createElement('option');
    option.value = consoleItem.id;
    option.textContent = consoleItem.name;
    select.append(option);
  }
};

const renderAdminSlots = () => {
  const body = document.getElementById('adminSlots');
  body.replaceChildren();
  for (const slot of adminRecords.slots) {
    const row = document.createElement('tr');
    row.append(makeCell(slot.console?.name || 'Console'), makeCell(formatDateTime(slot.starts_at)), makeCell(formatDateTime(slot.ends_at)), makeCell(slot.available ? 'Open' : 'Hidden'));
    const actions = document.createElement('td');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'table-action';
    toggle.textContent = slot.available ? 'Hide' : 'Open';
    toggle.addEventListener('click', () => updateSlot(slot.id, { available: !slot.available }));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'table-action is-danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => deleteSlot(slot.id));
    actions.append(toggle, remove);
    row.append(actions);
    body.append(row);
  }
  document.getElementById('adminSlotsEmpty').hidden = adminRecords.slots.length > 0;
};

const renderAdmin = () => {
  renderAnalytics();
  renderAdminBookings();
  renderAdminGamers();
  renderConsoles();
  renderAdminSlots();
};

async function refreshAdmin() {
  try {
    adminRecords = await loadAdminRecords();
    renderAdmin();
    showMessage(feedback, '');
  } catch (error) {
    showMessage(feedback, error.message, true);
  }
}

async function setBookingStatus(bookingId, status) {
  showMessage(feedback, 'Updating booking…');
  const { error } = await supabase.rpc('admin_set_booking_status', { p_booking_id: bookingId, p_status: status });
  showMessage(feedback, error ? error.message : `Booking ${status}.`, Boolean(error));
  if (!error) await refreshAdmin();
}

async function updateSlot(slotId, update) {
  const { error } = await supabase.from('availability_slots').update(update).eq('id', slotId);
  showMessage(feedback, error ? error.message : 'Availability updated.', Boolean(error));
  if (!error) await refreshAdmin();
}

async function deleteSlot(slotId) {
  const { error } = await supabase.from('availability_slots').delete().eq('id', slotId);
  showMessage(feedback, error ? error.message : 'Time slot removed.', Boolean(error));
  if (!error) await refreshAdmin();
}

document.getElementById('consoleForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const { error } = await supabase.from('consoles').insert({
    name: form.elements.name.value.trim(),
    platform: form.elements.platform.value.trim(),
    hourly_rate: Number(form.elements.hourly_rate.value),
  });
  showMessage(feedback, error ? error.message : 'Console added.', Boolean(error));
  if (!error) {
    form.reset();
    form.elements.platform.value = 'PlayStation 5';
    await refreshAdmin();
  }
});

document.getElementById('availabilityForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.elements.end_time.value <= form.elements.start_time.value) {
    return showMessage(feedback, 'The end time must be later than the start time.', true);
  }
  const startsAt = new Date(`${form.elements.date.value}T${form.elements.start_time.value}`);
  const endsAt = new Date(`${form.elements.date.value}T${form.elements.end_time.value}`);
  const { error } = await supabase.from('availability_slots').insert({
    console_id: form.elements.console_id.value,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  });
  showMessage(feedback, error ? error.message : 'Availability added.', Boolean(error));
  if (!error) {
    form.elements.start_time.value = '';
    form.elements.end_time.value = '';
    await refreshAdmin();
  }
});

document.getElementById('analyticsFrom').value = localDate(new Date(dateToday.getFullYear(), dateToday.getMonth(), 1));
document.getElementById('analyticsTo').value = localDate(dateToday);
document.getElementById('bookingDateFilter').value = localDate(dateToday);
document.querySelector('#availabilityForm [name="date"]').min = localDate(dateToday);
document.getElementById('refreshAnalytics').addEventListener('click', refreshAdmin);
document.getElementById('analyticsFrom').addEventListener('change', renderAnalytics);
document.getElementById('analyticsTo').addEventListener('change', renderAnalytics);
document.getElementById('bookingSearch').addEventListener('input', renderAdminBookings);
document.getElementById('bookingStatusFilter').addEventListener('change', renderAdminBookings);
document.getElementById('bookingDateFilter').addEventListener('change', renderAdminBookings);
document.getElementById('gamerSearch').addEventListener('input', renderAdminGamers);

const boot = async () => {
  showMessage(feedback, 'Loading your account…');
  if (configurationError) return showMessage(feedback, configurationError, true);
  const { user, error } = await getCurrentUser();
  if (error || !user) return window.location.replace('account.html');
  const profileResult = await supabase.from('profiles').select('id,game_id,full_name,phone,role,created_at').eq('id', user.id).single();
  if (profileResult.error) return showMessage(feedback, profileResult.error.message, true);
  if (profileResult.data.role === 'admin') {
    adminView.hidden = false;
    document.getElementById('dashboardTitle').textContent = 'Admin operations';
    document.getElementById('dashboardIntro').textContent = 'Bookings, members, availability, and performance from your live records.';
    await refreshAdmin();
    const updates = supabase.channel('admin-dashboard');
    ['bookings', 'profiles', 'consoles', 'availability_slots'].forEach((table) => {
      updates.on('postgres_changes', { event: '*', schema: 'public', table }, refreshAdmin);
    });
    updates.subscribe();
  } else {
    await showGamerDashboard(profileResult.data, user);
  }
};

boot();
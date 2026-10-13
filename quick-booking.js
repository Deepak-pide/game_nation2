import { showMessage, supabase } from './supabase.js';

const dateInput = document.getElementById('guestBookingDate');
const slotList = document.getElementById('guestSlotList');
const emptyState = document.getElementById('guestSlotsEmpty');
const feedback = document.getElementById('guestBookingFeedback');
const dialog = document.getElementById('guestBookingDialog');
const form = document.getElementById('guestBookingForm');
const submitButton = document.getElementById('guestBookingSubmit');
const selectedSlotLabel = document.getElementById('guestSelectedSlot');
const dialogFeedback = document.getElementById('guestDialogFeedback');
const priceLabel = document.getElementById('guestBookingPrice');
const playerOptions = [...document.querySelectorAll('.guest-player-option')];
const pricePerPlayer = 20;
let selectedSlot = null;
let selectedPlayers = 1;

const localDateValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const formatSlotDate = (slot) => dateFormatter.format(new Date(slot.starts_at));
const formatSlotTime = (slot) => `${timeFormatter.format(new Date(slot.starts_at))} – ${timeFormatter.format(new Date(slot.ends_at))}`;

const updatePlayerIcons = () => {
  for (const option of playerOptions) {
    const icons = option.querySelector('.guest-player-icons');
    const count = Number(option.dataset.players);
    icons.replaceChildren();
    for (let index = 0; index < count; index += 1) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      head.setAttribute('cx', '12');
      head.setAttribute('cy', '7');
      head.setAttribute('r', '3.2');
      const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      body.setAttribute('d', 'M5.5 20v-1.6a6.5 6.5 0 0 1 13 0V20z');
      icon.append(head, body);
      icon.style.setProperty('--player-index', index);
      icons.append(icon);
    }
    option.classList.toggle('is-selected', count === selectedPlayers);
    option.setAttribute('aria-pressed', String(count === selectedPlayers));
  }
  priceLabel.textContent = `₹${selectedPlayers * pricePerPlayer}`;
};

const openBookingDialog = (slot) => {
  selectedSlot = slot;
  selectedPlayers = 1;
  selectedSlotLabel.textContent = `${slot.console_name} · ${formatSlotDate(slot)} · ${formatSlotTime(slot)}`;
  showMessage(dialogFeedback, '');
  form.reset();
  updatePlayerIcons();
  dialog.showModal();
  document.getElementById('guestBookingName').focus();
};

const loadSlots = async () => {
  selectedSlot = null;
  slotList.replaceChildren();
  emptyState.hidden = true;
  if (!supabase) {
    showMessage(feedback, 'Booking is temporarily unavailable. Please try again later.', true);
    return;
  }
  showMessage(feedback, 'Finding upcoming available slots…');
  const start = new Date(`${dateInput.value}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const { data, error } = await supabase.rpc('guest_list_quick_booking_slots', {
    p_starts_at: start.toISOString(),
    p_ends_at: end.toISOString(),
  });
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  if (!data.length) {
    emptyState.hidden = false;
    showMessage(feedback, '');
    return;
  }
  const dayGroups = new Map();
  for (const slot of data) {
    const dayKey = localDateValue(new Date(slot.starts_at));
    if (!dayGroups.has(dayKey)) {
      const group = document.createElement('section');
      group.className = 'guest-slot-day';
      const heading = document.createElement('h3');
      heading.textContent = formatSlotDate(slot);
      const grid = document.createElement('div');
      grid.className = 'guest-slot-list';
      group.append(heading, grid);
      slotList.append(group);
      dayGroups.set(dayKey, grid);
    }
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'guest-slot-option';
    card.setAttribute('aria-label', `${formatSlotTime(slot)}, select slot`);
    const time = document.createElement('strong');
    time.className = 'guest-slot-time';
    time.textContent = formatSlotTime(slot);
    const action = document.createElement('span');
    action.className = 'guest-slot-action';
    action.textContent = 'Select →';
    card.append(time, action);
    card.addEventListener('click', () => openBookingDialog(slot));
    dayGroups.get(dayKey).append(card);
  }
  showMessage(feedback, `${data.length} available slot${data.length === 1 ? '' : 's'} · Book up to ${dateFormatter.format(new Date(end.getTime() - 1))}`);
};

dateInput.value = localDateValue(new Date());
dateInput.min = dateInput.value;
dateInput.addEventListener('change', () => loadSlots().catch((error) => showMessage(feedback, error.message, true)));
playerOptions.forEach((option) => option.addEventListener('click', () => {
  selectedPlayers = Number(option.dataset.players);
  updatePlayerIcons();
}));
document.getElementById('closeGuestBooking').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedSlot || !form.reportValidity()) return;
  submitButton.disabled = true;
  showMessage(dialogFeedback, 'Booking your slot…');
  try {
    const { error } = await supabase.rpc('guest_create_quick_booking', {
      p_slot_id: selectedSlot.id,
      p_name: document.getElementById('guestBookingName').value.trim(),
      p_players: selectedPlayers,
    });
    if (error) {
      await loadSlots();
      showMessage(dialogFeedback, error.message, true);
      return;
    }
    dialog.close();
    await loadSlots();
    showMessage(feedback, 'Your slot is booked instantly. No approval is needed.');
  } catch (error) {
    showMessage(dialogFeedback, error instanceof Error ? error.message : 'Could not complete your booking.', true);
  } finally {
    submitButton.disabled = false;
  }
});

loadSlots().catch((error) => showMessage(feedback, error instanceof Error ? error.message : 'Could not load available slots.', true));

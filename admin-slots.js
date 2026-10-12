import { showMessage } from './supabase.js';
import { initializeAdminPage } from './admin-shared.js';

const feedback = document.getElementById('adminFeedback');
const today = new Date();
const dateValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateTime = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const cell = (value) => {
  const element = document.createElement('td');
  element.textContent = String(value ?? '');
  return element;
};

const start = async () => {
  const admin = await initializeAdminPage();
  if (!admin) return;
  const { supabase } = admin;
  const consoleList = document.getElementById('consoleList');
  const slotBody = document.getElementById('adminSlots');
  const consoleSelect = document.getElementById('availabilityConsole');
  const quickBookingForm = document.getElementById('quickBookingForm');
  const quickBookingConsole = document.getElementById('quickBookingConsole');
  const quickBookingDate = document.getElementById('quickBookingDate');
  const quickBookingSlot = document.getElementById('quickBookingSlot');
  const quickBookingPlayers = document.getElementById('quickBookingPlayers');
  const quickBookingSubmit = document.getElementById('quickBookingSubmit');
  const quickBookingFeedback = document.getElementById('quickBookingFeedback');
  const quickBookingPrice = document.getElementById('adminQuickBookingPrice');
  const loadQuickBookingSlots = async () => {
    quickBookingSubmit.disabled = true;
    quickBookingSlot.replaceChildren();
    if (!quickBookingConsole.value || !quickBookingDate.value) {
      const prompt = document.createElement('option');
      prompt.value = '';
      prompt.textContent = 'Choose a console and date first';
      quickBookingSlot.append(prompt);
      quickBookingSlot.disabled = true;
      return;
    }
    const dateStart = new Date(`${quickBookingDate.value}T00:00:00`);
    const dateEnd = new Date(dateStart);
    dateEnd.setDate(dateEnd.getDate() + 1);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Loading available slots…';
    quickBookingSlot.append(placeholder);
    quickBookingSlot.disabled = true;
    const [slotsResult, quickBookingsResult, bookingsResult] = await Promise.all([
      supabase.from('availability_slots')
        .select('id,console_id,starts_at,ends_at')
        .eq('console_id', quickBookingConsole.value)
        .eq('available', true)
        .gte('starts_at', dateStart.toISOString())
        .lt('starts_at', dateEnd.toISOString())
        .order('starts_at'),
      supabase.from('quick_bookings').select('slot_id'),
      supabase.from('bookings').select('starts_at,ends_at')
        .eq('console_id', quickBookingConsole.value)
        .in('status', ['pending', 'approved', 'completed'])
        .lt('starts_at', dateEnd.toISOString())
        .gt('ends_at', dateStart.toISOString()),
    ]);
    const failure = [slotsResult, quickBookingsResult, bookingsResult].find((result) => result.error);
    if (failure) {
      showMessage(quickBookingFeedback, failure.error.message, true);
      placeholder.textContent = 'Could not load available slots';
      quickBookingSlot.disabled = true;
      return;
    }
    const quickBookedSlotIds = new Set(quickBookingsResult.data.map((booking) => booking.slot_id));
    const openSlots = slotsResult.data.filter((slot) => {
      const startTime = new Date(slot.starts_at).getTime();
      const endTime = new Date(slot.ends_at).getTime();
      return startTime > Date.now()
        && !quickBookedSlotIds.has(slot.id)
        && !bookingsResult.data.some((booking) =>
          new Date(booking.starts_at).getTime() < endTime
          && new Date(booking.ends_at).getTime() > startTime);
    });
    quickBookingSlot.replaceChildren();
    const prompt = document.createElement('option');
    prompt.value = '';
    prompt.textContent = openSlots.length ? 'Choose an available slot' : 'No available slots on this date';
    quickBookingSlot.append(prompt);
    for (const slot of openSlots) {
      const option = document.createElement('option');
      option.value = slot.id;
      option.textContent = `${dateTime(slot.starts_at)} – ${dateTime(slot.ends_at)}`;
      quickBookingSlot.append(option);
    }
    quickBookingSlot.disabled = !openSlots.length;
    quickBookingSubmit.disabled = !openSlots.length;
  };
  const load = async () => {
    const [consolesResult, slotsResult] = await Promise.all([
      supabase.from('consoles').select('id,name,platform,hourly_rate,active').order('name'),
      supabase.from('availability_slots').select('id,console_id,starts_at,ends_at,available,console:consoles(name)').order('starts_at'),
    ]);
    const failure = [consolesResult, slotsResult].find((result) => result.error);
    if (failure) {
      showMessage(feedback, failure.error.message, true);
      return;
    }
    consoleList.replaceChildren();
    for (const item of consolesResult.data) {
      const form = document.createElement('form');
      form.className = 'console-row';
      const fields = [
        ['Name', 'name', item.name, 'text'],
        ['Platform', 'platform', item.platform, 'text'],
        ['Rate (₹/hr)', 'hourly_rate', item.hourly_rate, 'number'],
      ];
      for (const [labelText, name, value, type] of fields) {
        const label = document.createElement('label');
        label.className = 'form-field';
        label.append(document.createTextNode(labelText));
        const input = document.createElement('input');
        input.name = name;
        input.type = type;
        input.required = true;
        input.maxLength = 80;
        if (type === 'number') {
          input.min = '0';
          input.step = '0.01';
        }
        input.value = String(value);
        label.append(input);
        form.append(label);
      }
      const activeLabel = document.createElement('label');
      activeLabel.className = 'checkbox-field';
      const active = document.createElement('input');
      active.name = 'active';
      active.type = 'checkbox';
      active.checked = item.active;
      activeLabel.append(active, document.createTextNode('Active'));
      const save = document.createElement('button');
      save.type = 'submit';
      save.className = 'table-action';
      save.textContent = 'Save';
      form.append(activeLabel, save);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        save.disabled = true;
        const { error } = await supabase.from('consoles').update({
          name: form.elements.name.value.trim(),
          platform: form.elements.platform.value.trim(),
          hourly_rate: Number(form.elements.hourly_rate.value),
          active: form.elements.active.checked,
        }).eq('id', item.id);
        save.disabled = false;
        if (error) {
          showMessage(feedback, error.message, true);
          return;
        }
        showMessage(feedback, 'Console updated.');
        await load();
      });
      consoleList.append(form);
    }
    consoleSelect.replaceChildren();
    consolesResult.data.filter((item) => item.active).forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      consoleSelect.append(option);
    });
    quickBookingConsole.replaceChildren();
    consolesResult.data.filter((item) => item.active).forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      quickBookingConsole.append(option);
    });
    quickBookingConsole.disabled = !quickBookingConsole.options.length;
    slotBody.replaceChildren();
    slotsResult.data.forEach((slot) => {
      const row = document.createElement('tr');
      row.append(cell(slot.console?.name || 'Console'), cell(dateTime(slot.starts_at)), cell(dateTime(slot.ends_at)), cell(slot.available ? 'Open' : 'Hidden'));
      const actions = document.createElement('td');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'table-action';
      toggle.textContent = slot.available ? 'Hide' : 'Open';
      toggle.addEventListener('click', async () => {
        const { error } = await supabase.from('availability_slots').update({ available: !slot.available }).eq('id', slot.id);
        if (error) showMessage(feedback, error.message, true);
        else await load();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'table-action is-danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        const { error } = await supabase.from('availability_slots').delete().eq('id', slot.id);
        if (error) showMessage(feedback, error.message, true);
        else await load();
      });
      actions.append(toggle, remove);
      row.append(actions);
      slotBody.append(row);
    });
    document.getElementById('adminSlotsEmpty').hidden = slotsResult.data.length > 0;
    await loadQuickBookingSlots();
  };

  document.getElementById('consoleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const { error } = await supabase.from('consoles').insert({
      name: form.elements.name.value.trim(),
      platform: form.elements.platform.value.trim(),
      hourly_rate: Number(form.elements.hourly_rate.value),
    });
    if (error) {
      showMessage(feedback, error.message, true);
      return;
    }
    showMessage(feedback, 'Console added.');
    form.reset();
    form.elements.platform.value = 'PlayStation 5';
    await load();
  });

  document.getElementById('availabilityForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const startsAt = new Date(`${form.elements.date.value}T${form.elements.start_time.value}`);
    const endsAt = new Date(`${form.elements.date.value}T${form.elements.end_time.value}`);
    const durationMs = endsAt.getTime() - startsAt.getTime();
    const slotDurationMs = 60 * 60 * 1000;
    if (durationMs <= 0) {
      showMessage(feedback, 'The end time must be later than the start time.', true);
      return;
    }
    if (durationMs % slotDurationMs !== 0) {
      showMessage(feedback, 'Choose a time range that contains complete one-hour slots.', true);
      return;
    }
    const slots = Array.from({ length: durationMs / slotDurationMs }, (_, index) => {
      const slotStart = new Date(startsAt.getTime() + index * slotDurationMs);
      const slotEnd = new Date(slotStart.getTime() + slotDurationMs);
      return {
        console_id: form.elements.console_id.value,
        starts_at: slotStart.toISOString(),
        ends_at: slotEnd.toISOString(),
      };
    });
    const { error } = await supabase.from('availability_slots').insert(slots);
    if (error) {
      showMessage(feedback, error.message, true);
      return;
    }
    showMessage(feedback, `${slots.length} one-hour slot(s) added.`);
    form.elements.start_time.value = '';
    form.elements.end_time.value = '';
    await load();
  });
  quickBookingDate.value = dateValue(today);
  quickBookingDate.min = dateValue(today);
  quickBookingConsole.addEventListener('change', () => {
    showMessage(quickBookingFeedback, '');
    loadQuickBookingSlots();
  });
  quickBookingDate.addEventListener('change', () => {
    showMessage(quickBookingFeedback, '');
    loadQuickBookingSlots();
  });
  quickBookingPlayers.addEventListener('change', () => {
    quickBookingPrice.textContent = `Price: ₹20 per player · Total: ₹${Number(quickBookingPlayers.value) * 20}`;
  });
  quickBookingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    quickBookingSubmit.disabled = true;
    showMessage(quickBookingFeedback, 'Saving admin Quick Book reservation…');
    const { error } = await supabase.rpc('admin_create_quick_booking', {
      p_slot_id: quickBookingSlot.value,
      p_name: quickBookingForm.elements.name.value.trim(),
      p_players: Number(quickBookingPlayers.value),
    });
    quickBookingSubmit.disabled = false;
    if (error) {
      showMessage(quickBookingFeedback, error.message, true);
      await loadQuickBookingSlots();
      return;
    }
    quickBookingForm.elements.name.value = '';
    await load();
    showMessage(quickBookingFeedback, 'Quick Book reservation saved. Start and control its 40-minute timer from Live sessions.');
  });
  const dateInput = document.querySelector('#availabilityForm [name="date"]');
  dateInput.value = dateValue(today);
  dateInput.min = dateValue(today);
  await load();
  supabase.channel('admin-slot-page')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'consoles' }, load)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'availability_slots' }, load)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quick_bookings' }, load)
    .subscribe();
};

start().catch((error) => showMessage(feedback, error instanceof Error ? error.message : 'Could not load slot management.', true));

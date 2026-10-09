const bookingStorageKey = 'gameNationBookings';
const bookingDateInput = document.getElementById('bookingDate');
const selectedDateLabel = document.getElementById('selectedDateLabel');
const slotGroups = document.getElementById('slotGroups');
const bookingFeedback = document.getElementById('bookingFeedback');
const slotPeriods = [
  { name: 'Morning', start: 9, end: 12 },
  { name: 'Afternoon', start: 12, end: 17 },
  { name: 'Evening', start: 17, end: 21 },
];

const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const loadBookings = () => {
  try {
    const storedBookings = JSON.parse(window.localStorage.getItem(bookingStorageKey) || '{}');
    return storedBookings && typeof storedBookings === 'object' && !Array.isArray(storedBookings)
      ? storedBookings
      : {};
  } catch (error) {
    return {};
  }
};

let bookingsByDate = loadBookings();

const formatHour = (hour) => {
  const period = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${period}`;
};

const formatDateLabel = (dateString) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day, 12));
};

const saveBookings = () => {
  try {
    window.localStorage.setItem(bookingStorageKey, JSON.stringify(bookingsByDate));
    return true;
  } catch (error) {
    return false;
  }
};

const renderSlots = () => {
  const date = bookingDateInput.value;
  const bookedHours = new Set(bookingsByDate[date] || []);
  selectedDateLabel.textContent = formatDateLabel(date);
  slotGroups.replaceChildren();

  slotPeriods.forEach(({ name, start, end }) => {
    const section = document.createElement('section');
    section.className = 'slot-group';
    const heading = document.createElement('h2');
    heading.textContent = name;
    const grid = document.createElement('div');
    grid.className = 'slot-grid';

    for (let hour = start; hour < end; hour += 1) {
      const isBooked = bookedHours.has(hour);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `slot-button${isBooked ? ' is-booked' : ''}`;
      button.setAttribute('aria-pressed', String(isBooked));
      button.setAttribute('aria-label', `${formatHour(hour)} to ${formatHour(hour + 1)}, ${isBooked ? 'booked, select to remove booking' : 'available, select to book'}`);

      const time = document.createElement('span');
      time.className = 'slot-time';
      time.textContent = `${formatHour(hour)} – ${formatHour(hour + 1)}`;
      const state = document.createElement('span');
      state.className = 'slot-state';
      state.textContent = isBooked ? 'Booked' : 'Available';
      button.append(time, state);

      button.addEventListener('click', () => {
        const nextHours = new Set(bookingsByDate[date] || []);
        if (nextHours.has(hour)) {
          nextHours.delete(hour);
        } else {
          nextHours.add(hour);
        }

        if (nextHours.size) {
          bookingsByDate[date] = [...nextHours].sort((first, second) => first - second);
        } else {
          delete bookingsByDate[date];
        }

        const saved = saveBookings();
        bookingFeedback.textContent = saved
          ? `${formatHour(hour)} slot ${nextHours.has(hour) ? 'booked' : 'booking removed'}.`
          : 'Your browser could not save this booking. Check your local storage settings.';
        renderSlots();
      });

      grid.append(button);
    }

    section.append(heading, grid);
    slotGroups.append(section);
  });
};

bookingDateInput.value = getLocalDateString();
bookingDateInput.addEventListener('change', () => {
  bookingFeedback.textContent = '';
  renderSlots();
});
renderSlots();
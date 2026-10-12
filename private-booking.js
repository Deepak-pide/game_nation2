const form = document.getElementById('privateBookingForm');
const feedback = document.getElementById('privateBookingFeedback');
const fallback = document.getElementById('privateBookingFallback');
const dateInput = form.elements.date;
const phoneInput = form.elements.phone;

const localDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

dateInput.min = localDateString(new Date());

const validatePhone = () => {
  phoneInput.setCustomValidity(/^[0-9+(). -]{7,20}$/.test(phoneInput.value.trim())
    ? ''
    : 'Enter a valid phone number using digits, spaces, +, - or parentheses.');
};

phoneInput.addEventListener('input', validatePhone);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  validatePhone();
  if (!form.reportValidity()) return;

  const details = new FormData(form);
  const message = [
    'Hi Game Nation! I would like to request a private booking.',
    '',
    `Name: ${details.get('name').trim()}`,
    `Phone / WhatsApp: ${details.get('phone').trim()}`,
    `Preferred date: ${details.get('date')}`,
    `Preferred start time: ${details.get('time')}`,
    `Event: ${details.get('event')}`,
    `Group size: ${details.get('guests')}`,
    `Additional details: ${details.get('details').trim() || 'None'}`,
    '',
    'Please check availability and confirm the details with me.',
  ].join('\n');
  const whatsappUrl = `https://wa.me/9179349919?text=${encodeURIComponent(message)}`;
  fallback.href = whatsappUrl;
  fallback.hidden = false;
  feedback.textContent = 'Your request is ready. Send it in WhatsApp and our team will confirm your preferred slot.';
  feedback.classList.add('is-success');
  window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
});

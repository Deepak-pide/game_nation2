import { initializeAdminPage } from './admin-shared.js';
import { formatMoney, showMessage } from './supabase.js';

const metricsContainer = document.getElementById('adminOverviewMetrics');
const pendingBody = document.getElementById('adminPendingBookings');
const pendingEmpty = document.getElementById('adminPendingBookingsEmpty');
const bookingFeedback = document.getElementById('adminBookingFeedback');
const makeNode = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
};
const formatDateTime = (value) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));
const localDayBounds = (date) => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const initializeOverview = async (supabase) => {
  let loading = false;
  const load = async () => {
    if (loading) return;
    loading = true;
    try {
      const [bookingsResult, pendingResult, gamersResult, slotsResult] = await Promise.all([
        supabase.from('bookings').select('status,total_price,starts_at,ends_at'),
        supabase.from('bookings')
          .select('id,user_id,starts_at,ends_at,total_price,profile:profiles!bookings_user_id_fkey(full_name,game_id),console:consoles(name)', { count: 'exact' })
          .eq('status', 'pending').order('starts_at').limit(50),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'gamer'),
        supabase.from('availability_slots').select('starts_at,ends_at,available'),
      ]);
      const failed = [bookingsResult, pendingResult, gamersResult, slotsResult].find((result) => result.error);
      if (failed) throw failed.error;

      const now = new Date();
      const { start: dayStart, end: dayEnd } = localDayBounds(now);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const completed = bookingsResult.data.filter((booking) => booking.status === 'completed');
      const completedToday = completed.filter((booking) => {
        const at = new Date(booking.starts_at);
        return at >= dayStart && at < dayEnd;
      });
      const completedThisMonth = completed.filter((booking) => {
        const at = new Date(booking.starts_at);
        return at >= monthStart && at < nextMonth;
      });
      const todayRevenue = completedToday.reduce((total, booking) => total + Number(booking.total_price), 0);
      const monthRevenue = completedThisMonth.reduce((total, booking) => total + Number(booking.total_price), 0);
      const monthSlots = slotsResult.data.filter((slot) => {
        const at = new Date(slot.starts_at);
        return slot.available && at >= monthStart && at < nextMonth;
      });
      const availableHours = monthSlots.reduce((total, slot) =>
        total + (new Date(slot.ends_at) - new Date(slot.starts_at)) / 3600000, 0);
      const bookedHours = bookingsResult.data
        .filter((booking) => ['approved', 'completed'].includes(booking.status))
        .filter((booking) => {
          const at = new Date(booking.starts_at);
          return at >= monthStart && at < nextMonth;
        })
        .reduce((total, booking) =>
          total + (new Date(booking.ends_at) - new Date(booking.starts_at)) / 3600000, 0);
      const metrics = [
        ['Revenue today', formatMoney(todayRevenue)],
        ['Revenue this month', formatMoney(monthRevenue)],
        ['Pending requests', String(pendingResult.count || 0)],
        ['Completed this month', String(completedThisMonth.length)],
        ['Registered gamers', String(gamersResult.count || 0)],
        ['Slot utilization · month', `${availableHours ? Math.round((bookedHours / availableHours) * 100) : 0}%`],
      ];
      metricsContainer.replaceChildren();
      for (const [label, value] of metrics) {
        const card = makeNode('article', 'admin-overview-metric');
        card.append(makeNode('span', '', label), makeNode('strong', '', value));
        metricsContainer.append(card);
      }

      pendingBody.replaceChildren();
      for (const booking of pendingResult.data) {
        const row = document.createElement('tr');
        const player = booking.profile?.full_name
          ? `${booking.profile.full_name} · ${booking.profile.game_id || ''}`
          : booking.profile?.game_id || 'Player';
        row.append(
          makeNode('td', '', player),
          makeNode('td', '', booking.console?.name || 'Console'),
          makeNode('td', '', `${formatDateTime(booking.starts_at)} – ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(booking.ends_at))}`),
          makeNode('td', '', formatMoney(booking.total_price)),
        );
        const actions = makeNode('td', 'admin-request-actions');
        for (const [status, label] of [['approved', 'Approve'], ['rejected', 'Reject']]) {
          const button = makeNode('button', `table-action${status === 'rejected' ? ' is-danger' : ''}`, label);
          button.type = 'button';
          button.addEventListener('click', async () => {
            if (!window.confirm(`${label} this booking request for ${player}?`)) return;
            button.disabled = true;
            showMessage(bookingFeedback, `Updating booking request for ${player}…`);
            const { error } = await supabase.rpc('admin_set_booking_status', {
              p_booking_id: booking.id,
              p_status: status,
            });
            if (error) {
              button.disabled = false;
              showMessage(bookingFeedback, error.message, true);
              return;
            }
            showMessage(bookingFeedback, `Booking request ${status}.`);
            await load();
          });
          actions.append(button);
        }
        row.append(actions);
        pendingBody.append(row);
      }
      pendingEmpty.hidden = pendingResult.data.length > 0;
      if (!pendingResult.data.length) showMessage(bookingFeedback, '');
      showMessage(document.getElementById('adminFeedback'), '');
    } catch (error) {
      showMessage(document.getElementById('adminFeedback'), error instanceof Error ? error.message : 'Could not load admin analytics.', true);
    } finally {
      loading = false;
    }
  };

  document.getElementById('refreshAdminOverview').addEventListener('click', load);
  await load();
  supabase.channel('admin-overview')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'availability_slots' }, load)
    .subscribe();
};

initializeAdminPage().then((admin) => {
  if (admin) return initializeOverview(admin.supabase);
  return null;
}).catch((error) => {
  showMessage(document.getElementById('adminFeedback'), error instanceof Error ? error.message : 'Could not load admin overview.', true);
});

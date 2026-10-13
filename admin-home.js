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

const initializeOverview = async (admin) => {
  const { supabase, user } = admin;
  let loading = false;
  const load = async () => {
    if (loading) return;
    loading = true;
    try {
      const [bookingsResult, pendingResult, gamersResult, slotsResult, walletResult, resetResult] = await Promise.all([
        supabase.from('bookings').select('status,total_price,starts_at,ends_at'),
        supabase.from('bookings')
          .select('id,user_id,starts_at,ends_at,created_at,profile:profiles!bookings_user_id_fkey(full_name,game_id),console:consoles(name)', { count: 'exact' })
          .eq('status', 'pending').order('starts_at').limit(50),
        supabase.from('profiles').select('created_at').eq('role', 'gamer'),
        supabase.from('availability_slots').select('starts_at,ends_at,available'),
        supabase.from('admin_wallet_transactions').select('amount,created_at').order('created_at'),
        supabase.from('analytics_settings').select('reset_at').eq('singleton', true).single(),
      ]);
      const failed = [bookingsResult, pendingResult, gamersResult, slotsResult, walletResult, resetResult].find((result) => result.error);
      if (failed) throw failed.error;

      const now = new Date();
      const resetAt = new Date(resetResult.data.reset_at);
      const bookings = bookingsResult.data.filter((booking) => new Date(booking.starts_at) >= resetAt);
      const walletTransactions = walletResult.data.filter((transaction) => new Date(transaction.created_at) >= resetAt);
      const pendingCountResult = await supabase.from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .gte('created_at', resetAt.toISOString());
      if (pendingCountResult.error) throw pendingCountResult.error;
      const { start: dayStart, end: dayEnd } = localDayBounds(now);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const completed = bookings.filter((booking) => booking.status === 'completed');
      const completedToday = completed.filter((booking) => {
        const at = new Date(booking.starts_at);
        return at >= dayStart && at < dayEnd;
      });
      const completedThisMonth = completed.filter((booking) => {
        const at = new Date(booking.starts_at);
        return at >= monthStart && at < nextMonth;
      });
      const walletToday = walletTransactions.filter((transaction) => {
        const at = new Date(transaction.created_at);
        return at >= dayStart && at < dayEnd;
      });
      const walletThisMonth = walletTransactions.filter((transaction) => {
        const at = new Date(transaction.created_at);
        return at >= monthStart && at < nextMonth;
      });
      const todayRevenue = completedToday.reduce((total, booking) => total + Number(booking.total_price), 0)
        + walletToday.reduce((total, transaction) => total + Number(transaction.amount), 0);
      const monthRevenue = completedThisMonth.reduce((total, booking) => total + Number(booking.total_price), 0)
        + walletThisMonth.reduce((total, transaction) => total + Number(transaction.amount), 0);
      const adminWalletBalance = walletTransactions.reduce((total, transaction) => total + Number(transaction.amount), 0);
      const monthSlots = slotsResult.data.filter((slot) => {
        const at = new Date(slot.starts_at);
        return slot.available && at >= resetAt && at >= monthStart && at < nextMonth;
      });
      const availableHours = monthSlots.reduce((total, slot) =>
        total + (new Date(slot.ends_at) - new Date(slot.starts_at)) / 3600000, 0);
      const bookedHours = bookings
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
        ['Admin wallet', formatMoney(adminWalletBalance)],
        ['Pending requests', String(pendingCountResult.count || 0)],
        ['Completed this month', String(completedThisMonth.length)],
        ['Registered gamers', String(gamersResult.data.filter((gamer) => new Date(gamer.created_at) >= resetAt).length)],
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
  const resetDialog = document.getElementById('resetAnalyticsDialog');
  const resetForm = document.getElementById('resetAnalyticsForm');
  const resetPassword = document.getElementById('resetAnalyticsPassword');
  const resetFeedback = document.getElementById('resetAnalyticsFeedback');
  const resetSubmit = document.getElementById('confirmAnalyticsReset');
  document.getElementById('resetAdminAnalytics').addEventListener('click', () => {
    resetForm.reset();
    showMessage(resetFeedback, '');
    resetDialog.showModal();
    resetPassword.focus();
  });
  document.getElementById('cancelAnalyticsReset').addEventListener('click', () => resetDialog.close());
  resetDialog.addEventListener('click', (event) => {
    if (event.target === resetDialog) resetDialog.close();
  });
  resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!user.email) {
      showMessage(resetFeedback, 'The signed-in admin account has no email address to verify.', true);
      return;
    }
    resetSubmit.disabled = true;
    showMessage(resetFeedback, 'Verifying password…');
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: resetPassword.value,
      });
      if (authError) {
        showMessage(resetFeedback, authError.message, true);
        resetPassword.focus();
        return;
      }
      const { error } = await supabase.rpc('admin_reset_analytics');
      if (error) {
        showMessage(resetFeedback, error.message, true);
        return;
      }
      resetDialog.close();
      showMessage(bookingFeedback, 'Analytics reporting baseline reset. Booking and wallet history is unchanged.');
      await load();
    } catch (error) {
      showMessage(resetFeedback, error instanceof Error ? error.message : 'Could not reset analytics.', true);
    } finally {
      resetSubmit.disabled = false;
    }
  });
  await load();
  supabase.channel('admin-overview')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, load)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'availability_slots' }, load)
    .subscribe();
};

initializeAdminPage().then((admin) => {
  if (admin) return initializeOverview(admin);
  return null;
}).catch((error) => {
  showMessage(document.getElementById('adminFeedback'), error instanceof Error ? error.message : 'Could not load admin overview.', true);
});

import { formatMoney, showMessage } from './supabase.js';
import { initializeAdminPage } from './admin-shared.js';

const feedback = document.getElementById('gamerAdminFeedback');
const makeCell = (value) => {
  const cell = document.createElement('td');
  cell.textContent = String(value ?? '');
  return cell;
};
const formatPlaytime = (minutes) => `${Math.floor(Number(minutes) / 60)} hr ${Number(minutes) % 60} min`;

const start = async () => {
  const admin = await initializeAdminPage();
  if (!admin) return;
  const { supabase } = admin;
  const tableBody = document.getElementById('adminGamers');
  const search = document.getElementById('gamerSearch');

  const load = async () => {
    const [profilesResult, bookingsResult, walletResult] = await Promise.all([
      supabase.from('profiles').select('id,game_id,full_name,email,phone,created_at').eq('role', 'gamer').order('created_at', { ascending: false }),
      supabase.from('bookings').select('user_id'),
      supabase.rpc('get_admin_wallet_overview'),
    ]);
    const failure = [profilesResult, bookingsResult, walletResult].find((result) => result.error);
    if (failure) {
      showMessage(feedback, failure.error.message, true);
      return;
    }

    const query = search.value.trim().toLowerCase();
    const profiles = profilesResult.data.filter((profile) =>
      [profile.game_id, profile.full_name, profile.email].join(' ').toLowerCase().includes(query));
    const bookingCounts = new Map();
    bookingsResult.data.forEach(({ user_id }) => bookingCounts.set(user_id, (bookingCounts.get(user_id) || 0) + 1));
    const wallets = new Map(walletResult.data.map((wallet) => [wallet.user_id, wallet]));
    tableBody.replaceChildren();
    for (const profile of profiles) {
      const wallet = wallets.get(profile.id);
      const row = document.createElement('tr');
      row.append(
        makeCell(profile.game_id),
        makeCell(profile.full_name || 'Player'),
        makeCell(profile.email || '—'),
        makeCell(profile.phone || '—'),
        makeCell(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(profile.created_at))),
        makeCell(bookingCounts.get(profile.id) || 0),
        makeCell(wallet ? formatPlaytime(wallet.available_minutes) : '0 hr 0 min'),
      );
      const amountCell = document.createElement('td');
      const amountInput = document.createElement('input');
      amountInput.className = 'table-cell-input';
      amountInput.type = 'number';
      amountInput.min = '0.01';
      amountInput.max = '1000000';
      amountInput.step = '0.01';
      amountInput.placeholder = '₹ amount';
      amountInput.setAttribute('aria-label', `Credit amount for ${profile.game_id}`);
      amountCell.append(amountInput);
      const actionsCell = document.createElement('td');
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'table-action';
      addButton.textContent = 'Add credit';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'table-action is-danger';
      deleteButton.textContent = 'Delete account';
      deleteButton.setAttribute('aria-label', `Delete account ${profile.game_id}`);
      deleteButton.addEventListener('click', async () => {
        const confirmed = window.confirm(
          `Permanently delete ${profile.game_id} (${profile.full_name || 'Player'})? Their account, bookings, wallet history, tournament results, and points will be deleted. This cannot be undone.`,
        );
        if (!confirmed) return;

        deleteButton.disabled = true;
        showMessage(feedback, `Deleting gamer account ${profile.game_id}…`);
        const { error } = await supabase.rpc('admin_delete_gamer', { p_user_id: profile.id });
        if (error) {
          deleteButton.disabled = false;
          showMessage(feedback, error.message, true);
          return;
        }
        await load();
        showMessage(feedback, `Gamer account ${profile.game_id} was permanently deleted.`);
      });
      addButton.addEventListener('click', async () => {
        const amount = Number(amountInput.value);
        if (!Number.isFinite(amount) || amount <= 0) {
          showMessage(feedback, 'Enter a credit amount greater than zero.', true);
          amountInput.focus();
          return;
        }
        addButton.disabled = true;
        const { error } = await supabase.rpc('admin_add_wallet_credit', {
          p_user_id: profile.id,
          p_amount: amount,
          p_note: `Admin playtime credit · ${formatMoney(amount)}`,
        });
        addButton.disabled = false;
        if (error) {
          showMessage(feedback, error.message, true);
          return;
        }
        showMessage(feedback, `Credit added for ${profile.game_id}.`);
        await load();
      });
      actionsCell.append(addButton, deleteButton);
      row.append(amountCell, actionsCell);
      tableBody.append(row);
    }
    document.getElementById('adminGamersEmpty').hidden = profiles.length > 0;
    showMessage(feedback, '');
  };

  search.addEventListener('input', load);
  await load();
  supabase.channel('admin-gamers-page')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions' }, load)
    .subscribe();
};

start().catch((error) => {
  showMessage(feedback, error instanceof Error ? error.message : 'Could not load gamer accounts.', true);
});

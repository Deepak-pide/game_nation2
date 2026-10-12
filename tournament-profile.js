import { showMessage } from './supabase.js';

let historyChannel;

export const loadTournamentProfile = async (supabase, userId) => {
  const feedback = document.getElementById('tournamentProfileFeedback')
    || document.getElementById('dashboardFeedback');
  const body = document.getElementById('gamerTournamentHistory');
  const empty = document.getElementById('gamerTournamentHistoryEmpty');
  const metrics = document.getElementById('gamerTournamentMetrics');
  const { data, error } = await supabase.rpc('get_my_tournament_history');
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  showMessage(feedback, '');

  const summary = {
    points: data.reduce((sum, row) => sum + Number(row.points), 0),
    wins: data.reduce((sum, row) => sum + Number(row.wins), 0),
    losses: data.reduce((sum, row) => sum + Number(row.losses), 0),
    tournaments: data.filter((row) => Number(row.matches_played) > 0).length,
    titles: data.filter((row) => row.tournament_win).length,
  };
  metrics.replaceChildren();
  [
    ['Tournament points', summary.points],
    ['Wins / losses', `${summary.wins} / ${summary.losses}`],
    ['Tournaments played', summary.tournaments],
    ['Tournament wins', summary.titles],
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'gamer-tournament-metric';
    const term = document.createElement('span');
    term.textContent = label;
    const number = document.createElement('strong');
    number.textContent = String(value);
    item.append(term, number);
    metrics.append(item);
  });

  body.replaceChildren();
  empty.hidden = data.length > 0;
  data.forEach((history) => {
    const row = document.createElement('tr');
    const linkCell = document.createElement('td');
    const link = document.createElement('a');
    link.href = `tournament.html?id=${encodeURIComponent(history.tournament_id)}`;
    link.textContent = history.tournament_name;
    linkCell.append(link);
    row.append(linkCell);
    for (const value of [
      history.game,
      history.status.replaceAll('_', ' '),
      history.matches_played,
      `${history.wins} / ${history.losses}`,
      history.points,
    ]) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    body.append(row);
  });
  if (historyChannel) await supabase.removeChannel(historyChannel);
  historyChannel = supabase.channel(`gamer-tournament-history-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, () => loadTournamentProfile(supabase, userId))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_registrations' }, () => loadTournamentProfile(supabase, userId))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches' }, () => loadTournamentProfile(supabase, userId))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_match_results' }, () => loadTournamentProfile(supabase, userId))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_points_transactions' }, () => loadTournamentProfile(supabase, userId))
    .subscribe();
};

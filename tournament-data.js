export const formatTournamentDate = (value) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

export const formatTournamentDay = (value) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
}).format(new Date(value));

export const tournamentStatusLabel = (status) => ({
  created: 'Upcoming',
  registration_open: 'Registration open',
  registration_closed: 'Registration closed',
  bracket_ready: 'Bracket ready',
  live: 'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
}[status] || status);

export const tournamentFilterFor = (tournament) => {
  if (tournament.status === 'live') return 'live';
  if (tournament.status === 'completed') return 'completed';
  if (tournament.status === 'cancelled') return 'cancelled';
  return 'upcoming';
};

export const renderTournamentLeaderboard = (players, body, empty) => {
  body.replaceChildren();
  empty.hidden = players.length > 0;
  for (const player of players) {
    const row = document.createElement('tr');
    if (player.is_current_user) row.className = 'ranking-current-player';
    const values = [
      `#${player.rank}`,
      player.player_name || player.game_id,
      player.total_points,
      player.wins,
      player.losses,
      player.tournaments_played,
      player.tournament_wins,
    ];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      if (index === 1 && player.is_current_user) {
        const marker = document.createElement('span');
        marker.className = 'current-player-label';
        marker.textContent = 'You';
        cell.append(marker);
      }
      row.append(cell);
    });
    body.append(row);
  }
};

export const getStatusBadge = (status) => {
  const badge = document.createElement('span');
  badge.className = `tournament-status status-${status.replaceAll('_', '-')}`;
  badge.textContent = tournamentStatusLabel(status);
  return badge;
};

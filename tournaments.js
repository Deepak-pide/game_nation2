import { configurationError, showMessage, supabase } from './supabase.js';
import {
  formatTournamentDate,
  formatTournamentDay,
  getStatusBadge,
  renderTournamentLeaderboard,
  tournamentFilterFor,
} from './tournament-data.js';

const feedback = document.getElementById('tournamentFeedback');
const list = document.getElementById('tournamentList');
const empty = document.getElementById('tournamentEmpty');
let tournaments = [];
let currentFilter = 'upcoming';
let leaderboardRequest = 0;

const renderTournaments = () => {
  list.replaceChildren();
  const visible = tournaments.filter((tournament) =>
    currentFilter === 'all' || tournamentFilterFor(tournament) === currentFilter);
  empty.hidden = visible.length > 0;
  for (const tournament of visible) {
    const card = document.createElement('article');
    card.className = `tournament-card${tournament.featured ? ' is-featured-tournament' : ''}`;
    const heading = document.createElement('div');
    heading.className = 'tournament-card-heading';
    const title = document.createElement('div');
    const game = document.createElement('p');
    game.className = 'eyebrow';
    game.textContent = tournament.game;
    const name = document.createElement('h2');
    name.textContent = tournament.name;
    title.append(game, name);
    heading.append(title, getStatusBadge(tournament.status));
    card.append(heading);

    const description = document.createElement('p');
    description.className = 'tournament-card-description';
    description.textContent = tournament.description || `${tournament.game} knockout tournament.`;
    card.append(description);
    const facts = document.createElement('dl');
    facts.className = 'tournament-card-facts';
    [
      ['Entry', tournament.entry_details],
      ['Players', `${tournament.players_registered} / ${tournament.max_players}`],
      ['Prize', tournament.prize_details],
      ['Points per win', String(tournament.points_per_win)],
      ['Date', formatTournamentDay(tournament.tournament_at)],
      ['Register by', formatTournamentDate(tournament.registration_deadline)],
    ].forEach(([label, value]) => {
      const item = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      item.append(term, detail);
      facts.append(item);
    });
    card.append(facts);
    const actions = document.createElement('div');
    actions.className = 'tournament-card-actions';
    const detailLink = document.createElement('a');
    detailLink.className = 'nav-pill';
    detailLink.href = `tournament.html?id=${encodeURIComponent(tournament.id)}`;
    detailLink.textContent = tournament.status === 'registration_open' ? 'Register' : 'View tournament';
    actions.append(detailLink);
    if (['bracket_ready', 'live', 'completed'].includes(tournament.status)) {
      const bracketLink = document.createElement('a');
      bracketLink.className = 'tournament-action-link';
      bracketLink.href = `${detailLink.href}#bracket-panel`;
      bracketLink.textContent = 'View bracket';
      actions.append(bracketLink);
    }
    if (tournament.status === 'completed') {
      const resultLink = document.createElement('a');
      resultLink.className = 'tournament-action-link';
      resultLink.href = `${detailLink.href}#leaderboard-panel`;
      resultLink.textContent = 'View results';
      actions.append(resultLink);
    }
    card.append(actions);
    list.append(card);
  }
};

const loadTournaments = async () => {
  if (!supabase) {
    showMessage(feedback, configurationError, true);
    return;
  }
  showMessage(feedback, 'Loading tournaments…');
  const { data, error } = await supabase.rpc('get_tournaments_public');
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  tournaments = data;
  showMessage(feedback, '');
  renderTournaments();
  const gameFilter = document.getElementById('leaderboardGame');
  const selectedGame = gameFilter.value;
  gameFilter.replaceChildren(new Option('All games', ''));
  [...new Set(tournaments.map((tournament) => tournament.game))].sort().forEach((game) => {
    gameFilter.add(new Option(game, game));
  });
  gameFilter.value = selectedGame;
  await loadLeaderboard();
};

const loadLeaderboard = async () => {
  const request = ++leaderboardRequest;
  const body = document.getElementById('tournamentLeaderboard');
  const emptyState = document.getElementById('tournamentLeaderboardEmpty');
  body.setAttribute('aria-busy', 'true');
  const { data, error } = await supabase.rpc('get_tournament_leaderboard', {
    p_game: document.getElementById('leaderboardGame').value || null,
  });
  if (request !== leaderboardRequest) return;
  body.setAttribute('aria-busy', 'false');
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  renderTournamentLeaderboard(data, body, emptyState);
};

document.querySelectorAll('.tournament-filter').forEach((button) => {
  button.addEventListener('click', () => {
    currentFilter = button.dataset.filter;
    document.querySelectorAll('.tournament-filter').forEach((filter) => {
      const active = filter === button;
      filter.classList.toggle('is-active', active);
      filter.setAttribute('aria-pressed', String(active));
    });
    renderTournaments();
  });
});
document.getElementById('leaderboardGame').addEventListener('change', loadLeaderboard);
loadTournaments();
if (supabase) {
  supabase.channel('public-tournament-list')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, loadTournaments)
    .subscribe();
}

import { configurationError, showMessage, supabase } from './supabase.js';
import { formatTournamentDate, getStatusBadge } from './tournament-data.js';

const section = document.getElementById('featuredTournament');
const feedback = document.getElementById('featuredTournamentFeedback');

const loadFeaturedTournament = async () => {
  if (!supabase) {
    section.hidden = false;
    showMessage(feedback, configurationError, true);
    return;
  }
  const { data, error } = await supabase.rpc('get_tournaments_public');
  if (error) {
    section.hidden = false;
    showMessage(feedback, error.message, true);
    return;
  }
  const tournament = data.find((item) => item.featured && item.status !== 'cancelled');
  if (!tournament) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  showMessage(feedback, '');
  document.getElementById('featuredGame').textContent = tournament.game;
  document.getElementById('featuredName').textContent = tournament.name;
  document.getElementById('featuredDescription').textContent = tournament.description
    || 'Step into the arena and compete for tournament points.';
  const status = document.getElementById('featuredStatus');
  status.replaceWith(getStatusBadge(tournament.status));
  const currentStatus = section.querySelector('.featured-tournament-content .tournament-status');
  currentStatus.id = 'featuredStatus';
  const details = [
    ['Entry', tournament.entry_details],
    ['Players', `${tournament.players_registered} / ${tournament.max_players}`],
    ['Prize / points', `${tournament.prize_details} · ${tournament.points_per_win} pts per win`],
    ['Registration closes', formatTournamentDate(tournament.registration_deadline)],
  ];
  const facts = document.getElementById('featuredFacts');
  facts.replaceChildren();
  details.forEach(([label, value]) => {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const definition = document.createElement('dd');
    definition.textContent = value;
    item.append(term, definition);
    facts.append(item);
  });
  const detailUrl = `tournament.html?id=${encodeURIComponent(tournament.id)}`;
  const register = document.getElementById('featuredRegister');
  const canRegister = tournament.status === 'registration_open'
    && new Date(tournament.registration_deadline) > new Date()
    && tournament.players_registered < tournament.max_players;
  register.hidden = !canRegister;
  register.href = `${detailUrl}#registrationButton`;
  const bracket = document.getElementById('featuredBracket');
  bracket.hidden = !['bracket_ready', 'live', 'completed'].includes(tournament.status);
  bracket.href = `${detailUrl}#bracket-panel`;
  const results = document.getElementById('featuredResults');
  results.hidden = tournament.status !== 'completed';
  results.href = `${detailUrl}#leaderboard-panel`;
  document.getElementById('featuredDetails').href = detailUrl;
};

loadFeaturedTournament();
if (supabase) {
  supabase.channel('featured-tournament')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, loadFeaturedTournament)
    .subscribe();
}

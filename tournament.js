import { configurationError, getCurrentUser, showMessage, supabase } from './supabase.js';
import {
  formatTournamentDate,
  getStatusBadge,
} from './tournament-data.js';

const feedback = document.getElementById('tournamentFeedback');
const tournamentId = new URLSearchParams(window.location.search).get('id');
let detail;
let leaderboardRequest = 0;
let isGamer = false;
let isAdmin = false;

const makeNode = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const setActiveTab = (tabId) => {
  const tab = document.getElementById(`${tabId}-tab`);
  if (!tab) return;
  document.querySelectorAll('.tournament-tabs [role="tab"]').forEach((item) => {
    item.setAttribute('aria-selected', String(item === tab));
  });
  document.querySelectorAll('.tournament-tab-panel').forEach((panel) => {
    panel.hidden = panel.id !== tab.getAttribute('aria-controls');
  });
};

const renderFacts = (tournament, playersRegistered) => {
  const facts = document.getElementById('tournamentFacts');
  facts.replaceChildren();
  [
    ['Entry', tournament.entry_details],
    ['Players', `${playersRegistered} / ${tournament.max_players}`],
    ['Prize', tournament.prize_details],
    ['Points per win', String(tournament.points_per_win)],
    ['Tournament date', formatTournamentDate(tournament.tournament_at)],
    ['Registration deadline', formatTournamentDate(tournament.registration_deadline)],
  ].forEach(([label, value]) => {
    const item = makeNode('div');
    item.append(makeNode('dt', '', label), makeNode('dd', '', value));
    facts.append(item);
  });
};

const renderParticipants = (participants) => {
  const list = document.getElementById('participantList');
  list.replaceChildren();
  document.getElementById('participantsEmpty').hidden = participants.length > 0;
  document.getElementById('participantCount').textContent = `${participants.length} player${participants.length === 1 ? '' : 's'}`;
  participants.forEach((participant, index) => {
    const item = makeNode('li', 'participant-item');
    item.append(
      makeNode('span', 'participant-number', String(index + 1).padStart(2, '0')),
      makeNode('strong', '', participant.name || participant.game_id),
      makeNode('span', 'participant-game-id', participant.game_id),
    );
    list.append(item);
  });
};

const renderBracket = (matches) => {
  const bracket = document.getElementById('bracketView');
  bracket.replaceChildren();
  document.getElementById('bracketEmpty').hidden = matches.length > 0;
  const rounds = new Map();
  matches.forEach((match) => {
    if (!rounds.has(match.round_number)) rounds.set(match.round_number, { name: match.round_name, matches: [] });
    rounds.get(match.round_number).matches.push(match);
  });
  const orderedRounds = [...rounds.entries()].sort((first, second) => first[0] - second[0]);
  const activeRound = orderedRounds.find(([, round]) => round.matches.some((match) => match.status === 'live'))?.[0]
    ?? orderedRounds.find(([, round]) => round.matches.some((match) => match.status === 'scheduled'))?.[0];

  for (const [roundNumber, round] of orderedRounds) {
    const column = makeNode('section', `bracket-round${roundNumber === activeRound ? ' is-current-round' : ''}`);
    column.append(makeNode('h3', 'bracket-round-title', round.name));
    const matchGrid = makeNode('div', 'bracket-round-matches');
    for (const match of round.matches) {
      const card = makeNode('article', `bracket-match match-${match.status}`);
      const header = makeNode('div', 'bracket-match-heading');
      header.append(makeNode('span', '', `Match ${match.match_number}`), getStatusBadge(match.status));
      card.append(header);
      for (const [slot, player, score] of [
        ['a', match.player_a_name || (match.status === 'bye' ? 'BYE' : 'To be decided'), match.score_a],
        ['b', match.player_b_name || (match.status === 'bye' ? 'BYE' : 'To be decided'), match.score_b],
      ]) {
        const competitor = makeNode('div', `bracket-competitor${match[`player_${slot}_won`] ? ' is-winner' : ''}`);
        competitor.append(makeNode('span', '', player), makeNode('strong', '', score === null ? '—' : String(score)));
        card.append(competitor);
      }
      if (match.status === 'bye') card.append(makeNode('p', 'bye-note', 'Automatic advance · no points awarded'));
      matchGrid.append(card);
    }
    column.append(matchGrid);
    bracket.append(column);
  }
};

const renderMatches = (matches) => {
  const list = document.getElementById('matchList');
  list.replaceChildren();
  document.getElementById('matchesEmpty').hidden = matches.length > 0;
  matches.forEach((match) => {
    const card = makeNode('article', `tournament-match-card match-${match.status}`);
    const heading = makeNode('div', 'tournament-match-card-heading');
    heading.append(
      makeNode('div', '', `${match.round_name} · Match ${match.match_number}`),
      getStatusBadge(match.status),
    );
    const players = makeNode('div', 'tournament-match-players');
    players.append(
      makeNode('strong', match.player_a_won ? 'is-winner' : '', match.player_a_name || 'TBD'),
      makeNode('span', 'match-score', `${match.score_a ?? '—'} : ${match.score_b ?? '—'}`),
      makeNode('strong', match.player_b_won ? 'is-winner' : '', match.player_b_name || 'TBD'),
    );
    card.append(heading, players);
    if (match.status === 'bye') card.append(makeNode('p', 'bye-note', 'Bye · automatic advance, no points awarded'));
    list.append(card);
  });
};

const loadLeaderboard = async () => {
  const request = ++leaderboardRequest;
  const body = document.getElementById('detailLeaderboard');
  const empty = document.getElementById('detailLeaderboardEmpty');
  const { data, error } = await supabase.rpc('get_tournament_standings', {
    p_tournament_id: tournamentId,
  });
  if (request !== leaderboardRequest) return;
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  body.replaceChildren();
  empty.hidden = data.length > 0;
  data.forEach((player) => {
    const row = makeNode('tr', player.is_current_user ? 'ranking-current-player' : '');
    const rank = makeNode('td', '', `#${player.rank}`);
    const name = makeNode('td', '', player.player_name || player.game_id);
    if (player.is_current_user) name.append(makeNode('span', 'current-player-label', 'You'));
    row.append(rank, name);
    [player.points, player.wins, player.losses].forEach((value) => row.append(makeNode('td', '', String(value))));
    body.append(row);
  });
};

const renderDetail = () => {
  const { tournament, participants, matches, players_registered: playerCount, is_registered: registered } = detail;
  document.title = `Game Nation | ${tournament.name}`;
  document.getElementById('tournamentDetail').hidden = false;
  document.getElementById('tournamentNotFound').hidden = true;
  document.getElementById('detailGame').textContent = tournament.game;
  document.getElementById('detailName').textContent = tournament.name;
  const status = document.getElementById('detailStatus');
  status.replaceWith(getStatusBadge(tournament.status));
  document.querySelector('.tournament-detail-heading .tournament-status').id = 'detailStatus';
  document.getElementById('detailDescription').textContent = tournament.description || '';
  document.getElementById('overviewDescription').textContent = tournament.description || 'No tournament overview has been added.';
  document.getElementById('detailRules').textContent = tournament.rules || 'No special rules have been added.';
  renderFacts(tournament, playerCount);
  renderParticipants(participants);
  renderBracket(matches);
  renderMatches(matches);

  const registerButton = document.getElementById('registrationButton');
  const registrationAvailable = tournament.status === 'registration_open'
    && new Date(tournament.registration_deadline) > new Date()
    && playerCount < tournament.max_players;
  registerButton.hidden = isAdmin || !registrationAvailable;
  registerButton.disabled = false;
  registerButton.classList.toggle('is-withdraw', registered);
  registerButton.textContent = registered ? 'Withdraw registration' : isGamer ? 'Register' : 'Sign in to register';
  registerButton.dataset.action = registered ? 'withdraw' : isGamer ? 'register' : 'signin';
  document.getElementById('bracketLink').hidden = matches.length === 0;
  document.getElementById('resultsLink').hidden = !matches.some((match) => match.status === 'completed');
};

const loadDetail = async () => {
  if (!supabase) {
    showMessage(feedback, configurationError, true);
    return;
  }
  if (!tournamentId) {
    document.getElementById('tournamentNotFound').hidden = false;
    showMessage(feedback, 'A tournament ID is required.', true);
    return;
  }
  const { data, error } = await supabase.rpc('get_tournament_details', { p_tournament_id: tournamentId });
  if (error) {
    document.getElementById('tournamentNotFound').hidden = false;
    showMessage(feedback, error.message, true);
    return;
  }
  detail = data;
  const { user } = await getCurrentUser();
  if (user) {
    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('role').eq('id', user.id).single();
    if (profileError) {
      showMessage(feedback, profileError.message, true);
      return;
    }
    isGamer = profile.role === 'gamer';
    isAdmin = profile.role === 'admin';
  }
  showMessage(feedback, '');
  renderDetail();
  if (window.location.hash === '#registrationButton') {
    window.requestAnimationFrame(() => document.getElementById('registrationButton').scrollIntoView({ block: 'center' }));
  }
  if (document.getElementById('leaderboard-panel').hidden === false) await loadLeaderboard();
};

document.querySelectorAll('.tournament-tabs [role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    setActiveTab(tab.id.replace('-tab', ''));
    if (tab.id === 'leaderboard-tab' && detail) loadLeaderboard();
  });
});
document.getElementById('bracketLink').addEventListener('click', (event) => {
  event.preventDefault();
  setActiveTab('bracket');
  document.getElementById('bracket-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('resultsLink').addEventListener('click', (event) => {
  event.preventDefault();
  setActiveTab('leaderboard');
  loadLeaderboard();
  document.getElementById('leaderboard-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('registrationButton').addEventListener('click', async (event) => {
  if (!detail) return;
  const button = event.currentTarget;
  if (button.dataset.action === 'signin') {
    window.location.assign('account.html');
    return;
  }
  if (button.dataset.action === 'register') {
    button.disabled = true;
    const { error } = await supabase.rpc('register_for_tournament', { p_tournament_id: tournamentId });
    if (error) {
      showMessage(feedback, error.message, true);
    } else {
      showMessage(feedback, 'Registration confirmed. You are on the participant list.');
      await loadDetail();
    }
    button.disabled = false;
  } else if (button.dataset.action === 'withdraw') {
    if (!window.confirm('Withdraw from this tournament?')) return;
    button.disabled = true;
    const { error } = await supabase.rpc('withdraw_from_tournament', { p_tournament_id: tournamentId });
    if (error) {
      showMessage(feedback, error.message, true);
    } else {
      showMessage(feedback, 'Your registration has been withdrawn.');
      await loadDetail();
    }
    button.disabled = false;
  }
});

const initialTab = ['overview-panel', 'participants-panel', 'bracket-panel', 'matches-panel', 'leaderboard-panel']
  .includes(window.location.hash.slice(1)) ? window.location.hash.slice(1).replace('-panel', '') : 'overview';
setActiveTab(initialTab);
loadDetail();
if (supabase && tournamentId) {
  supabase.channel(`tournament-${tournamentId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${tournamentId}` }, loadDetail)
    .subscribe();
}

import { showMessage } from './supabase.js';
import { formatTournamentDate, getStatusBadge, tournamentStatusLabel } from './tournament-data.js';

const form = document.getElementById('tournamentForm');
const feedback = document.getElementById('tournamentAdminFeedback');
let client;
let tournaments = [];
let selectedTournamentId = null;
let selectedDetail = null;

const makeNode = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const toLocalDateTime = (value) => {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const resetTournamentForm = () => {
  form.reset();
  form.elements.id.value = '';
  form.elements.max_players.value = '16';
  form.elements.points_per_win.value = '10';
  form.elements.entry_details.value = 'Free entry';
  form.elements.prize_details.value = 'Tournament points';
  form.querySelector('[type="submit"]').textContent = 'Create tournament';
  document.getElementById('cancelTournamentEdit').hidden = true;
};

const editTournament = (tournament) => {
  form.elements.id.value = tournament.id;
  form.elements.name.value = tournament.name;
  form.elements.game.value = tournament.game;
  form.elements.tournament_at.value = toLocalDateTime(tournament.tournament_at);
  form.elements.registration_deadline.value = toLocalDateTime(tournament.registration_deadline);
  form.elements.max_players.value = tournament.max_players;
  form.elements.points_per_win.value = tournament.points_per_win;
  form.elements.entry_details.value = tournament.entry_details;
  form.elements.prize_details.value = tournament.prize_details;
  form.elements.description.value = tournament.description || '';
  form.elements.rules.value = tournament.rules || '';
  form.elements.featured.checked = tournament.featured;
  form.querySelector('[type="submit"]').textContent = 'Save tournament';
  document.getElementById('cancelTournamentEdit').hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

const loadTournamentList = async () => {
  const { data, error } = await client.rpc('get_tournaments_public');
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  tournaments = data;
  const list = document.getElementById('adminTournamentList');
  list.replaceChildren();
  if (!data.length) {
    list.append(makeNode('p', 'empty-state', 'No tournaments created yet.'));
    return;
  }
  data.forEach((tournament) => {
    const card = makeNode('article', `admin-tournament-card${tournament.featured ? ' is-featured-tournament' : ''}`);
    const info = makeNode('div', 'admin-tournament-card-info');
    info.append(
      makeNode('p', 'eyebrow', tournament.game),
      makeNode('h3', '', tournament.name),
      makeNode('p', 'admin-tournament-card-copy', `${tournament.players_registered} / ${tournament.max_players} players · ${formatTournamentDate(tournament.tournament_at)}`),
    );
    const status = getStatusBadge(tournament.status);
    const actions = makeNode('div', 'admin-tournament-card-actions');
    const select = makeNode('button', 'table-action', selectedTournamentId === tournament.id ? 'Selected' : 'Manage');
    select.type = 'button';
    select.addEventListener('click', () => loadTournamentDetails(tournament.id));
    actions.append(select);
    if (['created', 'registration_open', 'registration_closed'].includes(tournament.status)) {
      const edit = makeNode('button', 'table-action', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', () => editTournament(tournament));
      actions.append(edit);
    }
    card.append(info, status, actions);
    list.append(card);
  });
};

const runAdminAction = async (name, args, successMessage) => {
  showMessage(feedback, 'Saving tournament changes…');
  const { error } = await client.rpc(name, args);
  if (error) {
    showMessage(feedback, error.message, true);
    return false;
  }
  showMessage(feedback, successMessage);
  await loadTournamentList();
  if (selectedTournamentId) await loadTournamentDetails(selectedTournamentId);
  return true;
};

const fillPlayers = (select, selectedId, participants) => {
  select.replaceChildren(new Option('Unassigned / bye', ''));
  participants.forEach((player) => {
    const option = new Option(`${player.name} · ${player.game_id}`, player.user_id);
    option.disabled = !player.user_id;
    select.add(option);
  });
  select.value = selectedId || '';
};

const renderMatchups = (matches, participants, tournament) => {
  const list = document.getElementById('adminMatchupList');
  list.replaceChildren();
  const firstRound = matches.filter((match) => match.round_number === 1);
  if (!firstRound.length) {
    list.append(makeNode('p', 'empty-state', 'Close registration and prepare a bracket to assign first-round matchups.'));
    return;
  }
  firstRound.forEach((match) => {
    const card = makeNode('article', 'admin-matchup-card');
    const heading = makeNode('div', 'admin-matchup-card-heading');
    heading.append(makeNode('strong', '', `Match ${match.match_number}`), getStatusBadge(match.status));
    const playerFields = makeNode('div', 'admin-matchup-players');
    const playerA = document.createElement('select');
    const playerB = document.createElement('select');
    fillPlayers(playerA, match.player_a_id, participants);
    fillPlayers(playerB, match.player_b_id, participants);
    const playerAField = makeNode('label', 'form-field', 'Player A');
    const playerBField = makeNode('label', 'form-field', 'Player B');
    playerAField.append(playerA);
    playerBField.append(playerB);
    playerFields.append(playerAField, makeNode('span', 'admin-versus', 'VS'), playerBField);
    const saveMatchup = makeNode('button', 'table-action',
      match.status === 'bye' ? 'Edit bye' :
        (!match.player_a_id && !match.player_b_id ? 'Create matchup' : 'Save matchup'));
    saveMatchup.type = 'button';
    saveMatchup.disabled = ['completed'].includes(match.status) || tournament.status === 'completed';
    saveMatchup.addEventListener('click', async () => {
      saveMatchup.disabled = true;
      await runAdminAction('admin_save_matchup', {
        p_match_id: match.id,
        p_tournament_id: tournament.id,
        p_round_number: 1,
        p_match_number: match.match_number,
        p_player_a_id: playerA.value || null,
        p_player_b_id: playerB.value || null,
      }, 'Matchup saved.');
      saveMatchup.disabled = false;
    });
    const scoreFields = makeNode('div', 'admin-match-scores');
    const scoreA = document.createElement('input');
    scoreA.type = 'number';
    scoreA.min = '0';
    scoreA.value = match.score_a ?? '';
    scoreA.setAttribute('aria-label', `Match ${match.match_number} Player A score`);
    const scoreB = document.createElement('input');
    scoreB.type = 'number';
    scoreB.min = '0';
    scoreB.value = match.score_b ?? '';
    scoreB.setAttribute('aria-label', `Match ${match.match_number} Player B score`);
    const winner = document.createElement('select');
    fillPlayers(winner, match.winner_id, participants.filter((player) =>
      [match.player_a_id, match.player_b_id].includes(player.user_id)));
    winner.setAttribute('aria-label', `Match ${match.match_number} winner`);
    scoreFields.append(scoreA, makeNode('span', '', '—'), scoreB, winner);
    const resultActions = makeNode('div', 'admin-match-actions');
    const saveScore = makeNode('button', 'table-action', 'Save live score');
    saveScore.type = 'button';
    saveScore.disabled = tournament.status !== 'live' || !match.player_a_id || !match.player_b_id;
    saveScore.addEventListener('click', () => saveMatchResult(match, scoreA, scoreB, winner, false));
    const confirmScore = makeNode('button', 'table-action', match.status === 'completed' ? 'Confirm correction' : 'Confirm winner');
    confirmScore.type = 'button';
    confirmScore.disabled = tournament.status !== 'live' || !match.player_a_id || !match.player_b_id;
    confirmScore.addEventListener('click', () => saveMatchResult(match, scoreA, scoreB, winner, true));
    resultActions.append(saveScore, confirmScore);
    card.append(heading, playerFields, saveMatchup, scoreFields, resultActions);
    list.append(card);
  });
};

const saveMatchResult = async (match, scoreA, scoreB, winner, confirm) => {
  if (scoreA.value === '' || scoreB.value === '') {
    showMessage(feedback, 'Enter both match scores.', true);
    return;
  }
  if (confirm && !winner.value) {
    showMessage(feedback, 'Choose a winner before confirming the result.', true);
    return;
  }
  await runAdminAction('admin_record_match_result', {
    p_match_id: match.id,
    p_score_a: Number(scoreA.value),
    p_score_b: Number(scoreB.value),
    p_winner_id: confirm ? winner.value : null,
    p_confirm: confirm,
  }, confirm ? 'Match result confirmed and tournament points updated.' : 'Live score saved.');
};

const renderTournamentDetails = (detail) => {
  selectedDetail = detail;
  const tournament = detail.tournament;
  const section = document.getElementById('adminTournamentDetail');
  section.hidden = false;
  document.getElementById('adminTournamentTitle').textContent = tournament.name;
  const status = document.getElementById('adminTournamentStatus');
  status.replaceWith(getStatusBadge(tournament.status));
  section.querySelector('.section-heading .tournament-status').id = 'adminTournamentStatus';
  document.getElementById('adminParticipantCount').textContent = `(${detail.players_registered})`;
  const participants = document.getElementById('adminParticipantList');
  participants.replaceChildren();
  if (!detail.participants.length) participants.append(makeNode('p', 'empty-state', 'No registered players.'));
  detail.participants.forEach((player) => {
    const row = makeNode('div', 'admin-participant-row');
    row.append(makeNode('strong', '', player.name), makeNode('span', '', player.game_id));
    participants.append(row);
  });

  const actions = document.getElementById('adminTournamentActions');
  actions.replaceChildren();
  const addAction = (label, statusValue, confirmation) => {
    const button = makeNode('button', 'table-action', label);
    button.type = 'button';
    button.addEventListener('click', async () => {
      if (confirmation && !window.confirm(confirmation)) return;
      await runAdminAction('admin_set_tournament_status', {
        p_tournament_id: tournament.id,
        p_status: statusValue,
      }, `${label} complete.`);
    });
    actions.append(button);
  };
  if (['created', 'registration_closed'].includes(tournament.status)) addAction('Open registration', 'registration_open');
  if (tournament.status === 'registration_open') addAction('Close registration', 'registration_closed');
  if (tournament.status === 'registration_closed') {
    const addBracketAction = (label, randomize) => {
      const prepare = makeNode('button', 'table-action', label);
      prepare.type = 'button';
      prepare.addEventListener('click', async () => {
        prepare.disabled = true;
        const { error } = await client.rpc('admin_build_tournament_bracket', {
          p_tournament_id: tournament.id,
          p_randomize: randomize,
        });
        if (error) {
          showMessage(feedback, error.message, true);
          prepare.disabled = false;
          return;
        }
        await loadTournamentList();
        await loadTournamentDetails(tournament.id);
        showMessage(feedback, randomize
          ? 'Bracket generated. Byes advance automatically without points.'
          : 'Manual bracket prepared. Assign every first-round matchup before starting.');
      });
      actions.append(prepare);
    };
    addBracketAction('Generate random bracket', true);
    addBracketAction('Prepare for manual matchups', false);
  }
  if (tournament.status === 'bracket_ready') addAction('Start tournament', 'live');
  if (tournament.status === 'live') addAction('Finish tournament', 'completed');
  if (!['completed', 'cancelled'].includes(tournament.status)) {
    addAction('Cancel tournament', 'cancelled', 'Cancel this tournament? This cannot be undone.');
  }
  renderMatchups(detail.matches, detail.participants, tournament);
};

const renderTournamentAudit = (audit) => {
  const container = document.getElementById('adminTournamentAudit');
  container.replaceChildren();
  if (!audit.results.length && !audit.points.length) {
    container.append(makeNode('p', 'empty-state', 'No confirmed results or points transactions yet.'));
    return;
  }
  const resultHeading = makeNode('h5', '', 'Confirmed results');
  const resultTable = document.createElement('table');
  resultTable.innerHTML = '<thead><tr><th>Version</th><th>Round / match</th><th>Score</th><th>Winner</th><th>Recorded by</th><th>Date</th></tr></thead>';
  const resultBody = document.createElement('tbody');
  audit.results.forEach((result) => {
    const row = document.createElement('tr');
    [
      result.version,
      `${result.round_name} · Match ${result.match_number}`,
      result.score,
      result.winner,
      result.changed_by,
      new Date(result.created_at).toLocaleString(),
    ].forEach((value) => row.append(makeNode('td', '', String(value))));
    resultBody.append(row);
  });
  resultTable.append(resultBody);
  container.append(resultHeading, resultTable);

  const pointsHeading = makeNode('h5', '', 'Points transactions');
  const pointsTable = document.createElement('table');
  pointsTable.innerHTML = '<thead><tr><th>Round / match</th><th>Player</th><th>Event</th><th>Points</th><th>Date</th></tr></thead>';
  const pointsBody = document.createElement('tbody');
  audit.points.forEach((transaction) => {
    const row = document.createElement('tr');
    [
      `${transaction.round_name} · Match ${transaction.match_number}`,
      transaction.player,
      transaction.type,
      transaction.points,
      new Date(transaction.created_at).toLocaleString(),
    ].forEach((value) => row.append(makeNode('td', '', String(value))));
    pointsBody.append(row);
  });
  pointsTable.append(pointsBody);
  container.append(pointsHeading, pointsTable);
};

const loadTournamentDetails = async (tournamentId) => {
  selectedTournamentId = tournamentId;
  const { data, error } = await client.rpc('get_tournament_details', { p_tournament_id: tournamentId });
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  renderTournamentDetails(data);
  const { data: audit, error: auditError } = await client.rpc('admin_get_tournament_audit', {
    p_tournament_id: tournamentId,
  });
  if (auditError) {
    showMessage(feedback, auditError.message, true);
    return;
  }
  renderTournamentAudit(audit);
  await loadTournamentList();
};

export const initializeTournamentAdmin = async (supabaseClient) => {
  client = supabaseClient;
  resetTournamentForm();
  await loadTournamentList();
  client.channel('admin-tournament-management')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, async () => {
      if (selectedTournamentId) await loadTournamentDetails(selectedTournamentId);
      else await loadTournamentList();
    })
    .subscribe();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const args = {
      p_tournament_id: form.elements.id.value || null,
      p_name: form.elements.name.value.trim(),
      p_game: form.elements.game.value.trim(),
      p_description: form.elements.description.value.trim(),
      p_tournament_at: new Date(form.elements.tournament_at.value).toISOString(),
      p_registration_deadline: new Date(form.elements.registration_deadline.value).toISOString(),
      p_max_players: Number(form.elements.max_players.value),
      p_rules: form.elements.rules.value.trim(),
      p_entry_details: form.elements.entry_details.value.trim(),
      p_prize_details: form.elements.prize_details.value.trim(),
      p_points_per_win: Number(form.elements.points_per_win.value),
      p_featured: form.elements.featured.checked,
    };
    const { data, error } = await client.rpc('admin_save_tournament', args);
    submit.disabled = false;
    if (error) {
      showMessage(feedback, error.message, true);
      return;
    }
    const tournamentId = data;
    resetTournamentForm();
    showMessage(feedback, 'Tournament saved.');
    await loadTournamentList();
    await loadTournamentDetails(tournamentId);
  });
  document.getElementById('cancelTournamentEdit').addEventListener('click', resetTournamentForm);
};

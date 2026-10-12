import { configurationError, showMessage, supabase } from './supabase.js';

const feedback = document.getElementById('gameLibraryFeedback');

const createGameCard = (game) => {
  const card = document.createElement('article');
  card.className = 'game-card database-game-card';
  card.dataset.gameId = game.id;
  if (game.image_url) {
    const image = document.createElement('img');
    image.src = game.image_url;
    image.alt = game.title;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.hidden = true;
      const placeholder = document.createElement('div');
      placeholder.className = 'game-card-placeholder';
      placeholder.textContent = game.title.slice(0, 2).toUpperCase();
      card.prepend(placeholder);
    }, { once: true });
    card.append(image);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'game-card-placeholder';
    placeholder.textContent = game.title.slice(0, 2).toUpperCase();
    card.append(placeholder);
  }
  const body = document.createElement('div');
  body.className = 'game-card-body';
  const title = document.createElement('h3');
  title.textContent = game.title;
  const rating = document.createElement('span');
  rating.className = 'rating';
  const score = Number(game.rating);
  const fullStars = Math.floor(score);
  rating.append(document.createTextNode(`${'★'.repeat(fullStars)}${'☆'.repeat(5 - fullStars)} `));
  const ratingText = document.createElement('small');
  ratingText.textContent = `${score.toFixed(1)}/5`;
  rating.append(ratingText);
  body.append(title, rating);
  card.append(body);
  return card;
};

const loadGames = async () => {
  if (!supabase) {
    showMessage(feedback, configurationError, true);
    return;
  }
  const { data, error } = await supabase.from('games')
    .select('id,title,mode,image_url,rating')
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  document.querySelectorAll('.tab-panel[id="solo"], .tab-panel[id="duo"], .tab-panel[id="squad"]').forEach((panel) => {
    panel.querySelectorAll('.database-game-card').forEach((card) => card.remove());
  });
  for (const game of data) {
    const grid = document.querySelector(`#${CSS.escape(game.mode)} .game-grid`);
    if (grid) grid.append(createGameCard(game));
  }
  showMessage(feedback, '');
};

loadGames();
if (supabase) {
  supabase.channel('public-game-library')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, loadGames)
    .subscribe();
}

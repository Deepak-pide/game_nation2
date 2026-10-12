import { showMessage } from './supabase.js';
import { youtubeVideoId } from './youtube.js';

const form = document.getElementById('addGameForm');
const feedback = document.getElementById('gameAdminFeedback');
const list = document.getElementById('adminGameList');
let client;

const renderAdminGames = (games) => {
  list.replaceChildren();
  if (!games.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No extra games have been added.';
    list.append(empty);
    return;
  }
  games.forEach((game) => {
    const card = document.createElement('article');
    card.className = `admin-game-row${game.active ? '' : ' is-disabled'}`;
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = game.title;
    const details = document.createElement('span');
    details.textContent = `${game.mode} · ${Number(game.rating).toFixed(1)} / 5${game.youtube_url ? ' · Trailer added' : ' · No trailer'}${game.active ? '' : ' · Hidden'}`;
    info.append(title, details);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'table-action';
    toggle.textContent = game.active ? 'Hide from library' : 'Show in library';
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      const { error } = await client.from('games').update({ active: !game.active }).eq('id', game.id);
      toggle.disabled = false;
      if (error) {
        showMessage(feedback, error.message, true);
        return;
      }
      showMessage(feedback, `${game.title} ${game.active ? 'hidden from' : 'added back to'} the game library.`);
      await loadGames();
    });
    card.append(info, toggle);
    list.append(card);
  });
};

const loadGames = async () => {
  const { data, error } = await client.from('games')
    .select('id,title,mode,image_url,rating,youtube_url,active')
    .order('created_at', { ascending: false });
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  renderAdminGames(data);
};

export const initializeGameAdmin = async (supabaseClient) => {
  client = supabaseClient;
  await loadGames();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const youtubeUrl = form.elements.youtube_url.value.trim();
    if (youtubeUrl && !youtubeVideoId(youtubeUrl)) {
      showMessage(feedback, 'Enter a valid YouTube watch, short, or embed link.', true);
      form.elements.youtube_url.focus();
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const { error } = await client.from('games').insert({
      title: form.elements.title.value.trim(),
      mode: form.elements.mode.value,
      image_url: form.elements.image_url.value.trim(),
      description: form.elements.description.value.trim(),
      youtube_url: youtubeUrl,
      rating: Number(form.elements.rating.value),
    });
    submit.disabled = false;
    if (error) {
      showMessage(feedback, error.message.includes('games_title_case_unique')
        ? 'That game is already in the library.'
        : error.message, true);
      return;
    }
    showMessage(feedback, 'Game added to the public library.');
    form.reset();
    form.elements.rating.value = '4.5';
    await loadGames();
  });
  client.channel('admin-game-library')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, loadGames)
    .subscribe();
};

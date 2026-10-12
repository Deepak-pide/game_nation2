import { configurationError, showMessage, supabase } from './supabase.js';
import { youtubeVideoId } from './youtube.js';

const feedback = document.getElementById('gameDetailsFeedback');
const hero = document.getElementById('gameHero');
const content = document.getElementById('gameContent');
const player = document.getElementById('gameTrailerPlayer');
const playButton = document.getElementById('playTrailer');

const loadGame = async () => {
  if (!supabase) {
    showMessage(feedback, configurationError, true);
    return;
  }
  const gameId = new URLSearchParams(window.location.search).get('id');
  if (!gameId || !/^[0-9a-f-]{36}$/i.test(gameId)) {
    showMessage(feedback, 'This game link is invalid or incomplete.', true);
    return;
  }
  const { data: game, error } = await supabase.from('games')
    .select('id,title,mode,image_url,description,youtube_url')
    .eq('id', gameId)
    .eq('active', true)
    .maybeSingle();
  if (error) {
    showMessage(feedback, error.message, true);
    return;
  }
  if (!game) {
    showMessage(feedback, 'This game is unavailable or has been removed from the library.', true);
    return;
  }

  document.title = `${game.title} | Game Nation`;
  document.getElementById('gameTitle').textContent = game.title;
  document.getElementById('gameAboutTitle').textContent = game.title;
  document.getElementById('gameMode').textContent = `${game.mode} · Game Nation library`;
  document.getElementById('gameDescription').textContent = game.description || 'More details about this game are coming soon.';
  document.getElementById('gameDescriptionPreview').textContent = game.description || 'Discover your next favorite game.';
  const image = document.getElementById('gameImage');
  if (game.image_url) {
    image.src = game.image_url;
    image.alt = `${game.title} cover art`;
    image.addEventListener('error', () => { image.hidden = true; }, { once: true });
  } else {
    image.hidden = true;
  }
  const videoId = youtubeVideoId(game.youtube_url);
  playButton.hidden = !videoId;
  document.getElementById('noTrailer').hidden = Boolean(videoId);
  playButton.addEventListener('click', () => {
    if (!videoId) return;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=0&playsinline=1&rel=0`;
    iframe.title = `${game.title} trailer`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allowFullscreen = true;
    player.replaceChildren(iframe);
    player.hidden = false;
    playButton.hidden = true;
  }, { once: true });
  hero.hidden = false;
  content.hidden = false;
  feedback.hidden = true;
};

loadGame();

const gameItems = document.querySelectorAll('.game-item');
const gamePanels = document.querySelectorAll('.game-panel');
const showcase = document.querySelector('.game-showcase');
const bookDemoBtn = document.getElementById('bookDemoBtn');
const footerBookDemoBtn = document.getElementById('footerBookDemoBtn');
const demoModal = document.getElementById('demoModal');
const closeDemoBtn = document.getElementById('closeDemoBtn');
const gameSoundToggle = document.getElementById('gameSoundToggle');
const heroScrollBtn = document.querySelector('.hero-scroll-btn');
const demoContactLinks = document.querySelectorAll('.demo-btn');
const demoBookedStorageKey = 'gameNationDemoBooked';
const updateBookDemoButtonLabel = () => {
  if (!bookDemoBtn) return;

  const isBooked = hasBookedDemo();
  bookDemoBtn.textContent = isBooked ? 'Contact' : 'Book Free Demo';
  bookDemoBtn.setAttribute('aria-label', isBooked ? 'Contact' : 'Book Free Demo');
};

const hasBookedDemo = () => {
  try {
    return window.localStorage.getItem(demoBookedStorageKey) === 'true';
  } catch (error) {
    return false;
  }
};

const markDemoAsBooked = () => {
  try {
    window.localStorage.setItem(demoBookedStorageKey, 'true');
  } catch (error) {
    // The button still remains visible for this visit if storage is unavailable.
  }

  updateBookDemoButtonLabel();
  closeDemoModal();
};

if (bookDemoBtn) {
  updateBookDemoButtonLabel();
}

const openDemoModal = () => {
  if (!demoModal) return;
  demoModal.classList.add('show');
  demoModal.setAttribute('aria-hidden', 'false');
};

const closeDemoModal = () => {
  if (!demoModal) return;
  demoModal.classList.remove('show');
  demoModal.setAttribute('aria-hidden', 'true');
};

if (bookDemoBtn) {
  bookDemoBtn.addEventListener('click', openDemoModal);
}

if (footerBookDemoBtn) {
  footerBookDemoBtn.addEventListener('click', openDemoModal);
}

if (closeDemoBtn) {
  closeDemoBtn.addEventListener('click', closeDemoModal);
}

demoContactLinks.forEach((link) => {
  link.addEventListener('click', markDemoAsBooked);
});

if (heroScrollBtn) {
  heroScrollBtn.addEventListener('click', () => {
    const target = document.querySelector(heroScrollBtn.dataset.scrollTarget || '#gta-showcase');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

if (demoModal) {
  demoModal.addEventListener('click', (event) => {
    if (event.target === demoModal) closeDemoModal();
  });
}

let pendingVideoLoadTimer = null;
let pendingVideoStartTimer = null;

activateGame('gta');

const sendPlayerCommand = (iframe, func, args = []) => {
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage(
    JSON.stringify({ event: 'command', func, args }),
    'https://www.youtube-nocookie.com'
  );
};

const playActiveVideo = (gameName) => {
  if (pendingVideoLoadTimer) clearTimeout(pendingVideoLoadTimer);
  if (pendingVideoStartTimer) clearTimeout(pendingVideoStartTimer);

  const activePanel = document.querySelector(`.game-panel[data-game="${gameName}"]`);
  const iframe = activePanel ? activePanel.querySelector('iframe') : null;
  if (!iframe || !iframe.dataset.src) return;

  gamePanels.forEach((panel) => {
    const isTarget = panel.dataset.game === gameName;
    const panelIframe = panel.querySelector('iframe');
    panel.classList.remove('video-ready');
    panel.classList.toggle('loading-video', isTarget);

    if (panelIframe && !isTarget) {
      sendPlayerCommand(panelIframe, 'stopVideo');
      panelIframe.src = '';
    }
  });

  pendingVideoLoadTimer = setTimeout(() => {
    if (!iframe.src || !iframe.src.includes(iframe.dataset.src.split('?')[0])) {
      iframe.src = iframe.dataset.src;
    }

    pendingVideoStartTimer = setTimeout(() => {
      sendPlayerCommand(iframe, 'playVideo');
      gamePanels.forEach((panel) => {
        panel.classList.remove('loading-video');
        panel.classList.toggle('video-ready', panel.dataset.game === gameName);
      });
    }, 250);
  }, 0);
};

const stopInactiveVideos = () => {
  gamePanels.forEach((panel) => {
    const iframe = panel.querySelector('iframe');
    if (!iframe || !iframe.dataset.src) return;

    if (!panel.classList.contains('is-active')) {
      sendPlayerCommand(iframe, 'stopVideo');
      iframe.src = '';
    }
  });
};

const activateGame = (gameName) => {
  gameItems.forEach((item) => {
    item.classList.toggle('is-active', item.dataset.game === gameName);
  });

  gamePanels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.game === gameName);
  });

  stopInactiveVideos();
  playActiveVideo(gameName);
};

gameItems.forEach((item) => {
  item.addEventListener('mouseenter', () => activateGame(item.dataset.game));
  item.addEventListener('focus', () => activateGame(item.dataset.game));
  item.addEventListener('click', () => activateGame(item.dataset.game));
});

const unlockShowcaseSound = () => {
  if (gameSoundEnabled) return;

  const activeIframe = document.querySelector('.game-panel.is-active iframe');
  if (!activeIframe) return;
  sendPlayerCommand(activeIframe, 'unMute');
  sendPlayerCommand(activeIframe, 'playVideo');
};

let gameSoundEnabled = false;

const updateGameSoundToggle = () => {
  if (!gameSoundToggle) return;

  gameSoundToggle.setAttribute('aria-pressed', String(gameSoundEnabled));
  gameSoundToggle.setAttribute('aria-label', gameSoundEnabled ? 'Mute game trailers' : 'Unmute game trailers');
  gameSoundToggle.setAttribute('title', gameSoundEnabled ? 'Mute game trailers' : 'Unmute game trailers');
  gameSoundToggle.classList.toggle('is-enabled', gameSoundEnabled);
};

if (gameSoundToggle) {
  gameSoundToggle.addEventListener('pointerdown', (event) => event.stopPropagation());
  gameSoundToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    gameSoundEnabled = !gameSoundEnabled;

    const activeIframe = document.querySelector('.game-panel.is-active iframe');
    if (activeIframe) {
      sendPlayerCommand(activeIframe, gameSoundEnabled ? 'unMute' : 'mute');
      sendPlayerCommand(activeIframe, 'playVideo');
    }

    updateGameSoundToggle();
  });

  updateGameSoundToggle();
}

document.addEventListener('pointerdown', unlockShowcaseSound, { passive: true });
document.addEventListener('keydown', unlockShowcaseSound);

const tabButtons = document.querySelectorAll('.tab-button');
const tabPanels = document.querySelectorAll('.tab-panel');

if (tabButtons.length && tabPanels.length) {
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;

      tabButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });

      tabPanels.forEach((panel) => {
        const active = panel.id === targetTab;
        panel.classList.toggle('active', active);
      });
    });
  });
}

const syncActiveGameFromScroll = () => {
  const visiblePanels = Array.from(gamePanels)
    .map((panel) => {
      const rect = panel.getBoundingClientRect();
      const viewportMid = window.innerHeight * 0.5;
      const distanceFromCenter = Math.abs(rect.top - (window.innerHeight - rect.height) / 2);

      return {
        panel,
        rect,
        distanceFromCenter,
        visible: rect.top < viewportMid && rect.bottom > window.innerHeight * 0.2,
      };
    })
    .filter((entry) => entry.visible)
    .sort((a, b) => a.distanceFromCenter - b.distanceFromCenter);

  if (!visiblePanels.length) return;
  activateGame(visiblePanels[0].panel.dataset.game);
};

window.addEventListener('scroll', syncActiveGameFromScroll, { passive: true });
window.addEventListener('resize', syncActiveGameFromScroll);
window.addEventListener('load', syncActiveGameFromScroll);




const gameItems = document.querySelectorAll('.game-item');
const gamePanels = document.querySelectorAll('.game-panel');
const showcase = document.querySelector('.game-showcase');
const splashScreen = document.getElementById('splashScreen');
const splashVideo = document.getElementById('splashVideo');
const bookDemoBtn = document.getElementById('bookDemoBtn');
const demoModal = document.getElementById('demoModal');
const closeDemoBtn = document.getElementById('closeDemoBtn');
const skipIntroBtn = document.getElementById('skipIntroBtn');
const demoContactLinks = document.querySelectorAll('.demo-btn');
const demoBookedStorageKey = 'gameNationDemoBooked';

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
    // The button still hides for this visit if storage is unavailable.
  }

  if (bookDemoBtn) bookDemoBtn.hidden = true;
  closeDemoModal();
};

if (bookDemoBtn && hasBookedDemo()) {
  bookDemoBtn.hidden = true;
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

if (closeDemoBtn) {
  closeDemoBtn.addEventListener('click', closeDemoModal);
}

demoContactLinks.forEach((link) => {
  link.addEventListener('click', markDemoAsBooked);
});

if (skipIntroBtn) {
  skipIntroBtn.addEventListener('click', () => {
    closeSplashScreen();
  });
}

if (demoModal) {
  demoModal.addEventListener('click', (event) => {
    if (event.target === demoModal) closeDemoModal();
  });
}

let splashClosed = false;
let showcaseUnlocked = false;
let pendingVideoLoadTimer = null;
let pendingVideoStartTimer = null;
let splashCloseTimer = null;

const closeSplashScreen = () => {
  if (!splashScreen || splashClosed) return;

  splashClosed = true;
  if (splashCloseTimer) clearTimeout(splashCloseTimer);
  splashScreen.classList.add('hidden');
  if (splashVideo) splashVideo.src = '';
  document.body.classList.add('flash-active');
  showcaseUnlocked = true;

  setTimeout(() => {
    document.body.classList.remove('flash-active');
    activateGame('gta');
  }, 700);
};

if (splashVideo) {
  if (splashVideo.dataset.src) {
    splashVideo.src = splashVideo.dataset.src;
  }

  const scheduleSplashClose = () => {
    if (splashClosed) return;
    if (splashCloseTimer) clearTimeout(splashCloseTimer);
    splashCloseTimer = setTimeout(closeSplashScreen, 26000);
  };

  splashVideo.addEventListener('load', scheduleSplashClose, { once: true });
  splashCloseTimer = setTimeout(closeSplashScreen, 32000);
}

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
      sendPlayerCommand(iframe, 'unMute');
      gamePanels.forEach((panel) => {
        panel.classList.remove('loading-video');
        panel.classList.toggle('video-ready', panel.dataset.game === gameName);
      });
    }, 200);
  }, 3000);
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
  if (splashScreen && !splashClosed) {
    return;
  }

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

if (showcase) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visibleEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visibleEntry) return;
      activateGame(visibleEntry.target.dataset.game);
    },
    {
      root: showcase,
      threshold: [0.55, 0.7, 0.85],
    }
  );

  gamePanels.forEach((panel) => observer.observe(panel));
}


import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: [
        'index.html',
        'quick-booking.html',
        'private-booking.html',
        'more-games.html',
        'game-details.html',
        'status.html',
        'account.html',
        'dashboard.html',
        'tournaments.html',
        'tournament.html',
        'my-tournaments.html',
        'admin.html',
        'admin-tournaments.html',
        'admin-gamers.html',
        'admin-slots.html',
        'admin-live.html',
        'admin-games.html',
        'admin-settings.html',
      ],
    },
  },
});
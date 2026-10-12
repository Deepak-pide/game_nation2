import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: ['index.html', 'more-games.html', 'status.html', 'account.html', 'dashboard.html', 'tournaments.html', 'tournament.html'],
    },
  },
});
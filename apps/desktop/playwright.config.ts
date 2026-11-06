import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { channel: process.env.CI ? 'chromium' : 'chrome', baseURL: 'http://127.0.0.1:1420' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: false },
});

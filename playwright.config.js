const {defineConfig} = require('@playwright/test');

const baseURL = 'http://127.0.0.1:4173';

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 3,
  reporter: 'list',
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
  },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({
    name: browserName,
    use: {browserName},
  })),
  webServer: {
    command: 'python3 build.py && python3 -m http.server 4173 --bind 127.0.0.1 --directory public',
    url: baseURL,
  },
});

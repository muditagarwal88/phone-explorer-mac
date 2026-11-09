// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/ui',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    trace: 'off',
  },
});

#!/usr/bin/env node
require('dotenv').config();
require('../src/platforms/discord/entrypoint').start().catch((err) => {
  console.error('Discord startup failed:', err.message);
  process.exit(1);
});

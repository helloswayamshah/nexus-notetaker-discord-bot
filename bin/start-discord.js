#!/usr/bin/env node
require('dotenv').config();
require('../adapters/discord/src/entrypoint').start().catch((err) => {
  console.error('Discord startup failed:', err.message);
  process.exit(1);
});

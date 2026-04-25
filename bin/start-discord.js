#!/usr/bin/env node
require('dotenv').config();
require('../src/platforms/discord/entrypoint').start();

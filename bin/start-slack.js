require('dotenv').config();
require('../adapters/slack/src/entrypoint').start().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

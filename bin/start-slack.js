require('dotenv').config();
require('../src/platforms/slack/entrypoint').start().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

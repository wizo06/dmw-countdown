// Import node modules
const discord = require('discord.js');
const path = require('path');
const logger = require('logger');
require('toml-require').install({ toml: require('toml') });

// Import config
const CONFIG = require(path.join(process.cwd(), 'config/config.toml'));

const BOT = new discord.Client({ retryLimit: Infinity });

/* Websocket has connection error */
BOT.on('error', err => {
  logger.error(err.message);
});

BOT.on('ready', async () => {
  logger.info(`Logged in as ${BOT.user.tag}`);
  logger.info(`**********************************************`);
  await BOT.user.setActivity('sourcies.dev', { type: 'PLAYING' });

  // Clean up #boss channel and send table to the channel
  require(path.join(process.cwd(), 'src/onStartup/displayTable.js')).run(BOT);
});

BOT.login(CONFIG.discord.token).catch(e => logger.error(e));


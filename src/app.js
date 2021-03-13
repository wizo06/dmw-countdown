// Import node modules
const discord = require('discord.js');
const path = require('path');
const logger = require('logger');
require('toml-require').install({ toml: require('toml') });

// Import utils
// const Auth = require(path.join(process.cwd(), 'src/utils/auth.js'));
// const CommandHandler = require(path.join(process.cwd(), 'src/utils/command_handler.js'));

// Import config
const CONFIG = require(path.join(process.cwd(), 'config/config.toml'));

const BOT = new discord.Client({ retryLimit: Infinity });

// let firstMessageInMVPChannel = true;
// const oneSecondInMilliseconds = 1000;
// const oneMinuteInSeconds = oneSecondInMilliseconds * 60;
// const thirtyMinutes = oneMinuteInSeconds * 30;

/* Listen to messages */
BOT.on('message', async msg => {
  // if (msg.channel.id === CONFIG.channels.mvpID) {
  //   if (firstMessageInMVPChannel) {
  //     firstMessageInMVPChannel = false;
  //     return;
  //   }
  //   BOT.setTimeout(async () => {
  //     await msg.delete();
  //   }, thirtyMinutes);
  // }
});

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


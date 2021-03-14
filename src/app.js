// Import node modules
const discord = require('discord.js');
const path = require('path');
const logger = require('logger');
const firebase = require(path.join(process.cwd(), 'src/utils/firebase.js'));
const moment = require('moment');
const momentTZ = require('moment-timezone');
require('toml-require').install({ toml: require('toml') });

const { fetchBossDB } = require(path.join(process.cwd(), 'src/onStartup/displayTable.js'));

// Import config
const CONFIG = require(path.join(process.cwd(), 'config/config.toml'));

const BOT = new discord.Client({ retryLimit: Infinity });

/* Listen to messages */
BOT.on('message', async msg => {
  if (msg.content.startsWith('Set') || msg.content.startsWith('set')) {
    let comm = msg.content.trim();
    let id = comm.split(' ')[1];
    let timestamp = comm.split(' ')[2];
    
    const snapshot = firebase.firestore().collection('bosses').where('order', '==', id).get();
    if (snapshot.empty) {
      logger.debug('boss does not exist');
      return;
    }
    
    // update lastkilledunix in bosses db
    if (CONFIG.discord.users.mst.includes(msg.author.id)) {
      const canOffset = momentTZ().tz('America/Edmonton').format('Z');
      const timestampUNIX = moment(`${timestamp} ${canOffset}`, 'hh:mmA Z').valueOf();
      await firebase.firestore().collection('bosses').doc(snapshot.docs[0].id).update({ lastKilledUNIX: timestampUNIX });
    }
    else if (CONFIG.discord.users.pty.includes(msg.author.id)) {
      const ptyOffset = momentTZ().tz('America/Panama').format('Z');
      const timestampUNIX = moment(`${timestamp} ${ptyOffset}`, 'hh:mmA Z').valueOf();
      await firebase.firestore().collection('bosses').doc(snapshot.docs[0].id).update({ lastKilledUNIX: timestampUNIX });
    }

    // update table to make it seem responsive
    let { output, embed, bossDocs } = await fetchBossDB(BOT);
    await sentMessage.edit(`\`\`\`${output}\`\`\``, { embed });
  }
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


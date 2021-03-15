const discord = require('discord.js');
const path = require('path');
const firebase = require(path.join(process.cwd(), 'src/utils/firebase.js'));
const { table } = require('table');
const logger = require('logger');
const moment = require('moment');
const momentTZ = require('moment-timezone');

const arrOfTimeoutObjs = [];

// Import config
const CONFIG = require(path.join(process.cwd(), 'config/config.toml'));

const buildTableAndEmbed = () => {
  return new Promise(async (resolve, reject) => {
    const snapshot = await firebase.firestore().collection('bosses').orderBy('order').get();
    if (snapshot.empty) {
      logger.error('db is empty');
      reject();
    }

    const desc = [];
    const arrOfRows = [['Name', 'City', 'ETA', 'LK (PTY)', 'LK (CAN)']];
    const docs = snapshot.docs;
    for (const doc of docs) {
      const icon = doc.data().icon;
      const monsterName = doc.data().monsterName;
      const cityName = doc.data().cityName;
      const respawnDuration = doc.data().respawnDuration;
      const lastKilledUNIX = doc.data().lastKilledUNIX;
      const order = doc.data().order;

      // Get hour and minute of respawn duration
      const hour = respawnDuration.match(/\d+h/i)[0].replace('h', '');
      const minute = respawnDuration.match(/\d+m/i)[0].replace('m', '');

      // Calculate when will boss respawn by adding lastKilledUNIX + hour & minute from respawn duration
      const respawnMomentObj = moment(lastKilledUNIX).add(hour, 'hours').add(minute, 'minutes');

      // Calculate how much time left from now until boss will respawn
      const diff = respawnMomentObj.diff(moment());

      const hourLeft = moment.duration(diff).hours();
      const minuteLeft = moment.duration(diff).minutes();
      const secondLeft = moment.duration(diff).seconds();
      let ETA = `${hourLeft}:${minuteLeft}:${secondLeft}`;

      // Check if time left is negative. If negative, then display '00:00:00' instead
      const msLeft = moment.duration(diff).asMilliseconds();
      if (msLeft < 0) ETA = '00:00:00';

      const PTYTime = momentTZ.tz(lastKilledUNIX, 'America/Panama').format('hh:mm A');
      const CANTime = momentTZ.tz(lastKilledUNIX, 'America/Edmonton').format('HH:mm');
      arrOfRows.push([monsterName, cityName, ETA, PTYTime, CANTime]);

      desc.push(`${icon} ${order}. ${monsterName} ${cityName}`);
    }

    const sortedArr = arrOfRows.sort((a, b) => {
      const aHour = a[2].split(':')[0];
      const aMinute = a[2].split(':')[1];
      const aSecond = a[2].split(':')[2];
      const bHour = b[2].split(':')[0];
      const bMinute = b[2].split(':')[1];
      const bSecond = b[2].split(':')[2];
      const aETA = moment.duration({ hours: aHour, minutes: aMinute, seconds: aSecond });
      const bETA = moment.duration({ hours: bHour, minutes: bMinute, seconds: bSecond });
      const diff = aETA.subtract(bETA).asMilliseconds();
      if (diff < 0) {
        return -1;
      }
      if (diff > 0) {
        return 1;
      }
      return 0;
    });

    for (const row of sortedArr) {
      if (row[2].split(':')[0] == 0 &&
        row[2].split(':')[1] == 0 &&
        row[2].split(':')[2] == 0)
        row[2] = 'ALIVE';
    }

    const tableConfig = {
      singleLine: true,
      columns: {
        2: { alignment: 'center', width: 10 },
        3: { alignment: 'center', width: 10 },
        4: { alignment: 'center', width: 10 },
      }
    };
    const output = table(sortedArr, tableConfig);

    const embed = new discord.MessageEmbed()
      .setTitle('React to start countdown')
      .setDescription(desc.join('\n'))

    resolve({ output, embed, bossDocs: docs });
  })
};

const editMessage = (sentMessage) => {
  return new Promise(async (resolve, reject) => {
    const { output, embed, bossDocs } = await buildTableAndEmbed();
    await sentMessage.edit(`\`\`\`${output}\`\`\``, { embed });
    resolve();
  });
};

const sendReadyMessage = (BOT) => {
  return new Promise(async (resolve, reject) => {
    const readyMsg = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send('✅ Ready to react');
    setTimeout(async () => {
      await readyMsg.delete();
      resolve();
    }, CONFIG.timers.reply_msg_lifespan);
  });
};

const sendFirstMessage = (BOT) => {
  return new Promise(async (resolve, reject) => {
    // SEND TABLE TO CHANNEL
    const { output, embed, bossDocs } = await buildTableAndEmbed();
    const sentMessage = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send(`\`\`\`${output}\`\`\``, { embed });
    // ADD BUTTONS
    logger.debug('Adding reactions');
    for (const doc of bossDocs) {
      await sentMessage.react(doc.data().icon);
    }
    resolve(sentMessage);
  });
};

const updateLastKilledUNIX = (timeInUNIX, bossDocID) => {
  return new Promise(async (resolve, reject) => {
    await firebase.firestore().collection('bosses').doc(bossDocID).update({ lastKilledUNIX: timeInUNIX });
    resolve();
  });
};

const createTimeout = async (BOT, timeoutDuration, bossDocID) => {
  // gather data to display
  const doc = await firebase.firestore().collection('bosses').doc(bossDocID).get();
  const monsterName = doc.data().monsterName;
  const cityName = doc.data().cityName;
  const pictureURL = doc.data().pictureURL;
  const order = doc.data().order;
  const embed = new discord.MessageEmbed()
    .setTitle(monsterName)
    .setAuthor('RESPAWNS IN LESS THAN 2 MINUTES!')
    .setDescription(cityName)
    .setThumbnail(pictureURL)
    .setColor('#00FF00')
    .setTimestamp()
  const msg = `<@&${CONFIG.discord.role.digimon}>`;

  // set timeout
  const timeoutObj = setTimeout(async () => {
    logger.debug(`Sending notification for ${monsterName} ${cityName}`);
    const aliveMsg = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send(msg, { embed });
    // remvoe from array
    const found = arrOfTimeoutObjs.find(ele => ele.bossOrder == order);
    const foundIndex = arrOfTimeoutObjs.findIndex(ele => ele.bossOrder == order);
    if (found) {
      logger.debug(`Timeout object for ${monsterName} found. Clearing it and removing from array`);
      clearTimeout(found.timeoutObj);
      arrOfTimeoutObjs.splice(foundIndex, 1);
    }
    // auto delete alive msg
    setTimeout(async () => {
      await aliveMsg.delete();
    }, CONFIG.timers.notif_lifespan);
  }, timeoutDuration);

  arrOfTimeoutObjs.push({ timeoutObj, bossOrder: order });
  logger.debug(`Timeout of ${moment.duration(timeoutDuration).asSeconds()}s for ${monsterName} created. Length of arrOfTimeoutObjs: ${arrOfTimeoutObjs.length}`);
};

const listenReaction = async (BOT, sentMessage) => {
  const snapshot = await firebase.firestore().collection('bosses').orderBy('order').get();

  BOT.on('messageReactionAdd', async (messageReaction, user) => {
    if (messageReaction.message.id === sentMessage.id) {
      // remove the reaction
      await messageReaction.users.remove(user.id);

      // check if reaction is valid
      let bossDocID = undefined;
      let respawnDuration = undefined;
      let lastKilledUNIX = undefined;
      let monsterName = undefined;
      for (const doc of snapshot.docs) {
        if (messageReaction.emoji.name === doc.data().icon) {
          bossDocID = doc.id;
          monsterName = doc.data().monsterName;
          respawnDuration = doc.data().respawnDuration;
          lastKilledUNIX = doc.data().lastKilledUNIX;
        }
      }
      if (bossDocID === undefined) {
        const errMsg = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send('❌ Invalid reaction');
        setTimeout(async () => {
          await errMsg.delete();
        }, CONFIG.timers.reply_msg_lifespan);
        logger.warning('Invalid reaction');
        return;
      }

      // check if boss is dead. if yes, no need to change lastkilledunix
      const hour = respawnDuration.match(/\d+h/i)[0].replace('h', '');
      const minute = respawnDuration.match(/\d+m/i)[0].replace('m', '');
      const respawnMomentObj = moment(lastKilledUNIX).add(hour, 'hours').add(minute, 'minutes');
      const diff = respawnMomentObj.diff(moment());
      const diffInMS = moment.duration(diff).asMilliseconds();
      // diffInMS < 0 means boss is ALIVE
      // diffInMS > 0 means boss is DEAD
      if (diffInMS > 0) {
        const errMsg = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send(`❌ Countdown for \`${monsterName}\` has already started. Cannot reset countdown.`);
        setTimeout(async () => {
          await errMsg.delete();
        }, CONFIG.timers.reply_msg_lifespan);
        logger.warning(`Countdown for ${monsterName} has already started`);
        return;
      }

      // Send confirmation message
      const confirmMsg = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send(`✅ Countdown started for \`${monsterName}\``);
      setTimeout(async () => {
        await confirmMsg.delete();
      }, CONFIG.timers.reply_msg_lifespan);

      // update lastKilledUNIX in bosses db
      await updateLastKilledUNIX(moment().valueOf(), bossDocID);

      // create timeout
      const newRespawnMomentObj = moment().add(hour, 'hours').add(minute, 'minutes').subtract(2, 'minutes');
      const newDiff = newRespawnMomentObj.diff(moment());
      const timeoutDuration = moment.duration(newDiff).asMilliseconds();
      createTimeout(BOT, timeoutDuration, bossDocID);

      // update table to make it seem responsive
      editMessage(sentMessage);
    }
  });

  await sendReadyMessage(BOT);
};

const listenMessage = (BOT, sentMessage) => {
  BOT.on('message', async msg => {
    if (msg.content.startsWith('Set') || msg.content.startsWith('set')) {
      const comm = msg.content.trim();
      const order = comm.split(' ')[1];
      const userInputTimestamp = comm.split(' ')[2];

      const snapshot = await firebase.firestore().collection('bosses').where('order', '==', parseInt(order)).get();
      if (snapshot.empty) {
        const errMsg = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send('❌ Invalid boss ID');
        setTimeout(async () => {
          await errMsg.delete();
        }, CONFIG.timers.reply_msg_lifespan);
        logger.debug(`Invalid boss ID (order): ${order}`);
        return;
      }

      const bossDocID = snapshot.docs[0].id;
      const monsterName = snapshot.docs[0].data().monsterName;
      let timestampUNIX = undefined;
      // update lastkilledunix in bosses db
      if (CONFIG.discord.users.mst.includes(msg.author.id)) {
        const canDate = momentTZ().tz('America/Edmonton').format('YYYY.MM.DD');
        const canOffset = momentTZ().tz('America/Edmonton').format('Z');
        timestampUNIX = moment(`${canDate} ${userInputTimestamp} ${canOffset}`, 'YYYY.MM.DD HH:mm Z').valueOf();
        await updateLastKilledUNIX(timestampUNIX, bossDocID);
      }
      else if (CONFIG.discord.users.pty.includes(msg.author.id)) {
        const ptyDate = momentTZ().tz('America/Panama').format('YYYY.MM.DD');
        const ptyOffset = momentTZ().tz('America/Panama').format('Z');
        timestampUNIX = moment(`${ptyDate} ${userInputTimestamp} ${ptyOffset}`, 'YYYY.MM.DD hh:mmA Z').valueOf();
        await updateLastKilledUNIX(timestampUNIX, bossDocID);
      }
      else {
        // ignore unauthorized users
        return;
      }
      
      // Send confirmation message
      logger.debug(`LK of ${monsterName} changed to ${moment(timestampUNIX).format('MM.DD HH:mm')}`);
      const confirmMsg = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send(`✅ LK of \`${monsterName}\` has been changed to \`${userInputTimestamp}\``);
      setTimeout(async () => {
        await confirmMsg.delete();
      }, CONFIG.timers.reply_msg_lifespan);

      // clear timeout if already exists
      // and also remove timeout object from array
      const found = arrOfTimeoutObjs.find(ele => ele.bossOrder == order);
      const foundIndex = arrOfTimeoutObjs.findIndex(ele => ele.bossOrder == order);
      if (found) {
        logger.debug(`Timeout object for ${monsterName} found. Clearing it and removing from array`);
        clearTimeout(found.timeoutObj);
        arrOfTimeoutObjs.splice(foundIndex, 1);
      }
      // create timeout
      const respawnDuration = snapshot.docs[0].data().respawnDuration;
      const hour = respawnDuration.match(/\d+h/i)[0].replace('h', '');
      const minute = respawnDuration.match(/\d+m/i)[0].replace('m', '');
      const respawnMomentObj = moment(timestampUNIX).add(hour, 'hours').add(minute, 'minutes').subtract(2, 'minutes');
      const diff = respawnMomentObj.diff(moment());
      const timeoutDuration = moment.duration(diff).asMilliseconds();
      createTimeout(BOT, timeoutDuration, bossDocID);
      
      // update table to make it seem responsive
      editMessage(sentMessage);
    }
  });
};

const startNotif = async (BOT) => {
  const snapshot = await firebase.firestore().collection('bosses').get();
  if (!snapshot.empty) {
    for (let doc of snapshot.docs) {
      const bossDocID = doc.id;
      const respawnDuration = doc.data().respawnDuration;
      const lastKilledUNIX = doc.data().lastKilledUNIX;
      const hour = respawnDuration.match(/\d+h/i)[0].replace('h', '');
      const minute = respawnDuration.match(/\d+m/i)[0].replace('m', '');
      const respawnMomentObj = moment(lastKilledUNIX).add(hour, 'hours').add(minute, 'minutes').subtract(2, 'minutes');
      const diff = respawnMomentObj.diff(moment());
      const diffInMS = moment.duration(diff).asMilliseconds();
      // diffInMS < 0 means boss is ALIVE
      // diffInMS > 0 means boss is DEAD
      if (diffInMS > 0) {
        // create timeout
        createTimeout(BOT, diffInMS, bossDocID);
      }
    }
  }
};

const autoCleanMsgs = async (BOT) => {
  BOT.on('message', async (msg) => {
    if (msg.channel.id === CONFIG.channels.id &&
        msg.author.bot === false) {
      setTimeout(() => {
        msg.delete();
      }, CONFIG.timers.reply_msg_lifespan);
    }
  });
};

const run = async BOT => {
  // CLEAN UP CHANNEL
  logger.debug('Cleaning channel');
  await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).bulkDelete(100);

  // SETUP AUTO CLEAN FOR MSGS THAT ARE NOT FROM BOT
  autoCleanMsgs(BOT);

  // SENT TABLE
  logger.debug('Sending table');
  const sentMessage = await sendFirstMessage(BOT);
  
  // START TIMEOUT FOR DEAD BOSSES
  logger.debug('Starting timeouts for dead bosses');
  startNotif(BOT);

  // EDIT MESSAGE EVERY INTERVAL TO MAKE IT REAL-TIME
  logger.debug('Starting setInterval for table');
  setInterval(async () => {
    await editMessage(sentMessage);
    // logger.debug(`arr len: ${arrOfTimeoutObjs.length}`);
  }, CONFIG.timers.redraw_interval);

  // LISTEN TO REACTIONS
  logger.debug('Listening for reactions');
  listenReaction(BOT, sentMessage);

  // LISTEN TO MESSAGES
  logger.debug('Listening for messages');
  listenMessage(BOT, sentMessage);
};

module.exports = { run };

const discord = require('discord.js');
const path = require('path');
const { table } = require('table');
const firebase = require(path.join(process.cwd(), 'src/utils/firebase.js'));
const logger = require('logger');
const moment = require('moment');
const momentTZ = require('moment-timezone');

// Import config
const CONFIG = require(path.join(process.cwd(), 'config/config.toml'));

const fetchBossDB = (BOT) => {
  return new Promise(async (resolve, reject) => {
    const snapshot = await firebase.firestore().collection('bosses').orderBy('monsterName').get();
    if (snapshot.empty) {
      await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send(`Database is empty`);
      logger.error('db is empty');
      return;
    }

    let desc = [];
    const arrOfRows = [['Name', 'City', 'ETA (h:m:s)', 'PTY', 'CAN']];
    const docs = snapshot.docs;
    for (let doc of docs) {
      const icon = doc.data().icon;
      const monsterName = doc.data().monsterName;
      const cityName = doc.data().cityName;
      const respawnDuration = doc.data().respawnTime;
      const lastKilledUNIX = doc.data().lastKilledUNIX;

      // Get hour and minute of respawn duration
      const hour = respawnDuration.match(/\d+h/i)[0].replace('h', '');
      const minute = respawnDuration.match(/\d+m/i)[0].replace('m', '');

      // Calculate when will boss respawn by adding lastKilledUNIX + hour & minute from respawn duration
      const respawnUNIX = moment(lastKilledUNIX).add(hour, 'hours').add(minute, 'minutes');

      // Calculate how much time left from now until boss will respawn
      const diff = respawnUNIX.diff(moment());

      const hourLeft = moment.duration(diff).hours();
      const minuteLeft = moment.duration(diff).minutes();
      const secondLeft = moment.duration(diff).seconds();
      let ETA = `${hourLeft}:${minuteLeft}:${secondLeft}`;

      // Check if time left is negative. If negative, then display 'ALIVE' instead
      const msLeft = moment.duration(diff).asMilliseconds();
      if (msLeft < 0) ETA = '00:00:00';

      const PTYTime = momentTZ.tz(lastKilledUNIX, 'America/Panama').format('hh:mm A');
      const CANTime = momentTZ.tz(lastKilledUNIX, 'America/Edmonton').format('HH:mm');
      arrOfRows.push([monsterName, cityName, ETA, PTYTime, CANTime]);

      desc.push(`${icon} ${monsterName} ${cityName}`);
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
      // console.log(`aETA: ${aETA}`)
      // console.log(`bETA: ${bETA}`)
      let diff = aETA.subtract(bETA).asMilliseconds();
      // console.log(diff)
      if (diff < 0) {
        return -1;
      }
      if (diff > 0) {
        return 1;
      }
      return 0;
    });

    for (let row of sortedArr) {
      if (row[2].split(':')[0] == 0 &&
        row[2].split(':')[1] == 0 &&
        row[2].split(':')[2] == 0)
        row[2] = 'ALIVE';
    }

    const output = table(sortedArr, { singleLine: true });

    const embed = new discord.MessageEmbed()
      .setTitle('React to start countdown')
      .setAuthor('WAIT FOR READY MESSAGE BEFORE REACTING')
      .setDescription(desc.join('\n'))

    resolve({ output, embed, bossDocs: docs });
  })
};

const startNotif = async (BOT, sentMessage) => {
  const snapshotNotif = await firebase.firestore().collection('notifications').get();
  if (!snapshotNotif.empty) {
    const docs = snapshotNotif.docs;
    for (let notifDoc of docs) {
      logger.debug('starting notification with id', notifDoc.id);
      const bossID = notifDoc.data().bossID;
      const bossDoc = await firebase.firestore().collection('bosses').doc(bossID).get();
      const respawnDuration = bossDoc.data().respawnTime;
      const hour = respawnDuration.match(/\d+h/i)[0].replace('h', '');
      const minute = respawnDuration.match(/\d+m/i)[0].replace('m', '');
      const respawnUNIX = moment().add(hour, 'hours').add(minute, 'minutes');
      // settimeout
      let millisecondsUntilRespawn = respawnUNIX - moment().valueOf();
      BOT.setTimeout(async () => {
        const doc = await firebase.firestore().collection('bosses').doc(bossID).get();
        const monsterName = doc.data().monsterName;
        const cityName = doc.data().cityName;
        const pictureURL = doc.data().pictureURL;
        const embed = new discord.MessageEmbed()
          .setTitle(monsterName)
          .setAuthor('RESPAWNED!')
          .setDescription(cityName)
          .setThumbnail(pictureURL)
          .setColor('#00FF00')

        const aliveMsg = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send({ embed });
        BOT.setTimeout(async () => {
          await aliveMsg.delete();
        }, 1000 * 60 * 5);
        // delete notification
        await firebase.firestore().collection('notifications').doc(notifDoc.id).delete();
        // update the discord message
        // let { output, embed, bossDocs } = await fetchBossDB(BOT);
        // await sentMessage.edit(`\`\`\`${output}\`\`\``, { embed });
      }, millisecondsUntilRespawn);
    }
  }
};

const refreshTable = async (BOT, sentMessage) => {
  const oneSecond = 1000;
  const tenSeconds = oneSecond * 10;
  BOT.setInterval(async () => {
    let { output, embed, bossDocs } = await fetchBossDB(BOT);
    await sentMessage.edit(`\`\`\`${output}\`\`\``, { embed });
  }, tenSeconds);
};

const run = async BOT => {
  // START ALL EXISTING NOTIF IN DB
  startNotif(BOT);

  // CLEAN UP CHANNEL
  await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).bulkDelete(100);

  // SEND TABLE TO CHANNEL
  let { output, embed, bossDocs } = await fetchBossDB(BOT);
  const sentMessage = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send(`\`\`\`${output}\`\`\``, { embed });
  // add reaction buttons
  for (let doc of bossDocs) {
    await sentMessage.react(doc.data().icon);
  }
  // send ready msg
  const readyMsg = await sentMessage.channel.send('✅ Ready to react');
  BOT.setTimeout(async () => {
    await readyMsg.delete();
  }, 1000 * 10);

  // REFRESH TABLE EVERY INTERVAL
  refreshTable(BOT, sentMessage);

  // SETUP LISTENER FOR REACTIONS
  BOT.on('messageReactionAdd', async (messageReaction, user) => {
    if (messageReaction.message.id === sentMessage.id) {
      // remove the reaction
      await messageReaction.users.remove(user.id);

      // Check if countdown is already active
      let id = undefined;
      let respawnDuration = undefined;
      for (let doc of bossDocs) {
        if (messageReaction.emoji.name === doc.data().icon) {
          id = doc.id;
          respawnDuration = doc.data().respawnTime;
        }
      }

      if (id == undefined) {
        logger.warning('reacted with invalid emoji');
        return;
      }

      const snapshotNotif = await firebase.firestore().collection('notifications').where('bossID', '==', id).get();
      // if snapshot is empty, then it means notif for this boss does not exist
      if (snapshotNotif.empty) {
        logger.debug('notification for boss does not exist. allow the creation of notificaion.');
        const hour = respawnDuration.match(/\d+h/i)[0].replace('h', '');
        const minute = respawnDuration.match(/\d+m/i)[0].replace('m', '');
        const respawnUNIX = moment().add(hour, 'hours').add(minute, 'minutes');
        const res = await firebase.firestore().collection('notifications').add({ bossID: id, respawnUNIX: respawnUNIX });
        await firebase.firestore().collection('bosses').doc(id).update({ lastKilledUNIX: moment().valueOf() });
        
        // update the discord message
        let { output, embed, bossDocs } = await fetchBossDB(BOT);
        await sentMessage.edit(`\`\`\`${output}\`\`\``, { embed });
        
        // settimeout for notification
        let millisecondsUntilRespawn = respawnUNIX - moment().valueOf();
        BOT.setTimeout(async () => {
          const doc = await firebase.firestore().collection('bosses').doc(id).get();
          const monsterName = doc.data().monsterName;
          const cityName = doc.data().cityName;
          const pictureURL = doc.data().pictureURL;
          const embed = new discord.MessageEmbed()
            .setTitle(monsterName)
            .setAuthor('RESPAWNED!')
            .setDescription(cityName)
            .setThumbnail(pictureURL)
            .setColor('#00FF00')
            
          const aliveMsg = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send({ embed });
          BOT.setTimeout(async () => {
            await aliveMsg.delete();
          }, 1000 * 60 * 5);
          // delete notification
          await firebase.firestore().collection('notifications').doc(res.id).delete();
          // update the discord message
          // let { output, embed, bossDocs } = await fetchBossDB(BOT);
          // await sentMessage.edit(`\`\`\`${output}\`\`\``, { embed });
        }, millisecondsUntilRespawn);
      }
      else {
        logger.debug('notification already exist. do not create a new notification.');
      }
    }
  });
};

module.exports = { run };

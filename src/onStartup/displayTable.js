const discord = require('discord.js');
const path = require('path');
const { table } = require('table')
const firebase = require(path.join(process.cwd(), 'src/utils/firebase.js'));
const logger = require('logger');
const moment = require('moment');
const momentTZ = require('moment-timezone');
require('toml-require').install({ toml: require('toml') });

// Import config
const CONFIG = require(path.join(process.cwd(), 'config/config.toml'));

const run = async BOT => {
  await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).bulkDelete(100);

  const snapshot = await firebase.firestore().collection('bosses').orderBy('monsterName').get();
  if (snapshot.empty) {
    await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send(`Database is empty`);
    logger.error('db is empty');
    return;
  }

  let desc = [];
  let icons = [];
  const arrOfRows = [['Name', 'City', 'ETA', 'PTY', 'CAN']];
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
    let ETA = `${hourLeft}:${minuteLeft}`;

    // Check if time left is negative. If negative, then display 'ALIVE' instead
    const msLeft = moment.duration(diff).asMilliseconds();
    if (msLeft < 0) ETA = 'ALIVE';

    const PTYTime = momentTZ.tz(lastKilledUNIX, 'America/Panama').format('hh:mm A');
    const CANTime = momentTZ.tz(lastKilledUNIX, 'America/Edmonton').format('HH:mm');
    arrOfRows.push([monsterName, cityName, ETA, PTYTime, CANTime]);

    desc.push(`${icon} ${monsterName} ${cityName}`);
    icons.push(icon);
  }

  const output = table(arrOfRows, { singleLine: true });
  console.log(output);

  const embed = new discord.MessageEmbed()
    .setTitle('React to start countdown')
    .setDescription(desc.join('\n'))
  
  const sentMessage = await BOT.guilds.cache.get(CONFIG.guilds.id).channels.cache.get(CONFIG.channels.id).send(`\`\`\`${output}\`\`\``, { embed });
  for (const icon of icons) {
    sentMessage.react(icon);
  }

  // process.env.mvpTableMsgID = sentMessage.id;
};

module.exports = { run };

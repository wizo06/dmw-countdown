const firebase = require('firebase-admin');
const path = require('path');

const serviceAccount = require(path.join(process.cwd(), 'config/serviceAccountKey.json'));

firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccount)
});

firebase.firestore().settings({ timestampsInSnapshots: true });

module.exports = firebase;
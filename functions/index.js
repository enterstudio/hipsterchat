const functions = require("firebase-functions");
const admin = require("firebase-admin");
const request = require("request-promise");
let translate = require('@google-cloud/translate')();

admin.initializeApp(functions.config().firebase);

exports.hello = functions.https.onRequest((req, res) => {
    res.send('hello, world!');
});

exports.translateMessages  = functions.database.ref('messages/{id}/msg').onWrite(event => {
    let snap = event.data;
    translate.getLanguages().then(([langs]) => {
        let work = langs.map(lang => {
            translate.translate(snap.val(), lang.code).then(([translation]) => {
                return snap.ref.parent.child(lang.code).set(translation);
            })
        });
        return Promise.all(work);
    })
});

exports.greetNewUsers = functions.auth.user().onCreate(event => {
    let user = event.data;
    return admin.database().ref('messages/general').push({
        text: `Welcome ${user.displayName}!`,
        imageUrl: `https://${process.env.GCLOUD_PROJECT}.firebaseapp.com/mr_mustachio.png`,
        name: 'MrMustachio',
        uid: 'MrMustachio',
    })
});

exports.iouMuffin = functions.analytics.event('feedback_sent').onLog(event => {
  const userId = event.data.user.userId;
  return admin.database().ref('muffinClub').transaction(value => {
    // Only have 12 muffins to give away:
    value = value || {};
    const givenAway = Object.keys(value).length;
    if (givenAway >= 12 || value[userId]) {
      return;
    }

    console.log(`Attempting to give away muffin ${givenAway + 1}`);
    value[userId] = (new Date()).toUTCString();
    return value;
  });
});

exports.manageRoomTopics = functions.database.ref('rooms/{room}/members/{uid}').onWrite(event => {
  let action = event.data.exists() ? 'batchAdd' : 'batchRemove';

  return admin.database().ref(`pushIds/${event.params.uid}`).once('value').then(tokenSnapshot => {
    let pushTokens = Object.keys(tokensSnapshot.val());
    if (pushTokens.length === 0) {
        console.log(`Cannot subscribe user ${event.params.uid} to room ${event.params.room}. They have no tokens`)
        return null;
    }

    console.log(`Adding ${pushTokens.length} tokens for user ${event.params.uid} to room ${event.params.room}`);
    //let oauthToken = await config.credential.getAccessToken();
    let options = {
        url: `https://iid.googleapis.com/iid/v1:${action}`,
        method: 'POST',
        headers: {
        Authorization: `key=${functions.config().fcm.server_key}`,//'Bearer ' + oauthToken.access_token,
        },
        json: true,
        body: {
        to: `/topics/room-${event.params.room}`,
        registration_tokens: pushTokens
        }
    };

    return request(options);
  });
  // TODO: A fuller implementation could remove tokens that were no longer valid.
  // Response is a results object with an array of errors or {} for no error.
});

exports.sendMentions = functions.database.ref('rooms/{room}/messages/{id}/msg').onWrite(event => {
  if (!event.data.val().match(/@here/)) {
    return "No @-mention";
  }

  console.log("Mentioning all users in room", event.params.room);
  let topic = "room-" + event.params.room;
  let payload = {
    notification: {
      title: "HipsterChat",
      body: "You have been mentioned in the room " + event.params.room
    }
  };

  return admin.messaging().sendToTopic(topic, payload);
});


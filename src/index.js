'use strict';

const fs = require('fs'),
  TelegramBot = require('node-telegram-bot-api'),
  path = require('path'),
  http = require('http'),
  moment = require('moment-timezone'),
  question = require('./questions'),
  schedule = require('node-schedule'),
  config = require('./config');

const port = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.end();
});

const subscribersFile = path.resolve(process.cwd(), 'src/subscribers.json');

const bot = new TelegramBot(config.bot.token, {
  polling: true
});

const dispatch = {
  recipients: {},
  threshold: {}
};

let subscribers = {
  admins: {},
  groups: {}
};

const subscriberExists = (id) => (subscribers.admins[id] || subscribers.groups[id]);

try {
  subscribers = JSON.parse(fs.readFileSync(subscribersFile));
} catch (e) {
  console.error('Cant load subsctibers');
}

bot.onText(new RegExp('start', 'i'), async (msg) => {
  const options = {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: [
        ['Subscribe'],
        ['Unsubscribe']
      ],
      one_time_keyboard: true,
      resize_keyboard: true
    }
  };
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '?', options);
});

bot.on('new_chat_members', (msg) => {
  const botId = bot.token.split(':')[0]
  const memberId = msg.new_chat_member.id
  if (botId == memberId) {
    const chatId = msg.chat.id;
    if (subscriberExists(msg.chat.id)) {
      return bot.sendMessage(chatId, 'Already subscribed');
    }
    subscribers.groups[msg.chat.id] = {
      chatId: msg.chat.id
    };
    fs.writeFile(subscribersFile, JSON.stringify(subscribers), (err) => {
      if (err) return bot.sendMessage(chatId, 'Ooops, cant subscribe');
      bot.sendMessage(chatId, 'Subscribed to bot');
    });
  }
})

bot.onText(new RegExp('^\/?subscribe$', 'i'), async (msg) => {
  const chatId = msg.chat.id;
  if (subscriberExists(msg.from.id)) {
    return bot.sendMessage(chatId, 'Already subscribed');
  }
  subscribers.admins[msg.from.id] = {
    chatId: msg.from.id
  };
  fs.writeFile(subscribersFile, JSON.stringify(subscribers), (err) => {
    if (err) return bot.sendMessage(chatId, 'Ooops, cant subscribe');
    bot.sendMessage(chatId, 'Subscribed');
  });
});

bot.on('polling_error', (error) => {
  console.log(error);  // => 'EFATAL'
});

// bot.onText(new RegExp('user', 'i'), async (msg) => {
//   const chatId = msg.chat.id;
//   if (subscriberExists(msg.chat.username)) {
//     return bot.sendMessage(chatId, 'Already subscribed');
//   }
//   subscribers.groups[msg.chat.username] = {
//     chatId: msg.chat.id
//   };
//   fs.writeFile(subscribersFile, JSON.stringify(subscribers), (err) => {
//     if (err) return bot.sendMessage(chatId, 'Ooops, cant subscribe');
//     bot.sendMessage(chatId, 'Subscribed as user');
//   });
// });

bot.onText(new RegExp('^\/?unsubscribe$', 'i'), async (msg) => {
  const chatId = msg.chat.id;
  let exist = false;
  if (subscribers.groups[msg.from.id]) {
    delete subscribers.groups[msg.from.id];
    exist = true;
  } else if (subscribers.admins[msg.from.id]) {
    delete subscribers.admins[msg.from.id];
    exist = true;
  }

  if (exist) {
    fs.writeFile(subscribersFile, JSON.stringify(subscribers), (err) => {
      if (err) return bot.sendMessage(chatId, 'Ooops, cant unsubscribe');
      bot.sendMessage(chatId, 'Unsubscribed');
    });
  } else {
    bot.sendMessage(chatId, 'User not found');
  }
});

bot.on('channel_post', (msg) => console.log(msg))

bot.onText(new RegExp('^\/\\d+$', 'i'), async (msg) => {
  if (dispatch.recipients[msg.chat.id]) {
    let value = msg.text.match(/\d/g)
    if (value) {
      value = value.join('');
      clearTimeout(dispatch.recipients[msg.chat.id]);
      delete dispatch.recipients[msg.chat.id];
      value = parseInt(value);
      if (dispatch.threshold.min > value) {
        sendToAdmins(`Sales is under threshold: ${value.toString()} 👎`);
      } else if (dispatch.threshold.max < value) {
        sendToAdmins(`Sales is over threshold: ${value.toString()} 👍`);
      }
      bot.sendMessage(msg.chat.id, 'Thank you!');
    } else {
      bot.sendMessage(msg.chat.id, 'Incorrect value');
    }
  }
});

const sendToAdmins = (message) => {
  for (let admin in subscribers.admins) {
    bot.sendMessage(subscribers.admins[admin].chatId, message);
  }
};

const sendQuestion = (threshold) => {
  dispatch.threshold = threshold;
  for (let user in subscribers.groups) {
    bot.sendMessage(subscribers.groups[user].chatId, question.question);
    if (!dispatch.recipients[user]) {
      dispatch.recipients[user] = setTimeout(() => bot.sendMessage(subscribers.groups[user].chatId, question.question), 900000);
    }
  }
};

bot.onText(new RegExp('^\/ask$', 'i'), () => sendQuestion({
  time: '2:23pm',
  min: 6000,
  max: 9000
}))


bot.onText(new RegExp('^\/gid$', 'i'), (msg) => {
  bot.sendMessage(msg.chat.id, msg.chat.id)
});

const jobs = []

for (let i of question.timer) {
  const t = moment.tz(i.time, 'h:mm A', 'Australia/Sydney').local();
  const rule = new schedule.RecurrenceRule();
  rule.hour = t.hours();
  rule.minute = t.minutes();
  rule.dayOfWeek = new schedule.Range(0, 6);

  const j = schedule.scheduleJob(rule, async () => {
    sendQuestion(i);
  });

  jobs.push(j);
}

bot.onText(new RegExp('date', 'i'), async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, Date.now().toString());
});


setInterval(() => {
  http.get('https://fuel-sale-bot.herokuapp.com/').on('error', ()=> {});
}, 1700000);

server.listen(port);

const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const config = {
  token: process.env.TOKENBOT,
  ownerId: process.env.USER,
  proposalsFile: 'proposals.json',
  maxImageSize: 5242880
};

let proposals = {};

if (fs.existsSync(config.proposalsFile)) {
  try {
    proposals = JSON.parse(fs.readFileSync(config.proposalsFile, 'utf8'));
  } catch (e) {
    proposals = {};
  }
}

function saveProposals() {
  fs.writeFileSync(config.proposalsFile, JSON.stringify(proposals, null, 2));
}

const bot = new TelegramBot(config.token, { polling: true });

bot.onText(/\/start/, (msg) => {
  const welcome = `
👋 Привет, ${msg.from.first_name}!

Отправь своё предложение сюда, и я передам его админу ))`;

  bot.sendMessage(msg.chat.id, welcome);
});

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;

  const chatId = msg.chat.id;
  const proposalKey = `${chatId}_${msg.message_id}`;
  
  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    if (photo.file_size > config.maxImageSize) {
      bot.sendMessage(chatId, '⚠️ Изображение слишком большое. Максимальный размер: 5MB');
      return;
    }
    await bot.sendPhoto(config.ownerId, photo.file_id, {
      caption: msg.caption || 'Изображение без описания'
    });
  } else if (msg.text) {
    await bot.sendMessage(config.ownerId, msg.text);
  }

  proposals[proposalKey] = {
    id: proposalKey,
    senderId: chatId,
    text: msg.text || msg.caption,
    fileId: msg.photo ? msg.photo[msg.photo.length - 1].file_id : null,
    timestamp: new Date().toISOString()
  };
  
  saveProposals();
  bot.sendMessage(chatId, '📤 Отправлено!');
});

process.on('uncaughtException', err => console.error('Ошибка:', err));
process.on('unhandledRejection', err => console.error('Отклонённый промис:', err));

console.log('@MNQ_CORP -- Community_bot || Бот запущен!');

const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
require('dotenv').config();

const config = {
  token: process.env.TOKENBOT,
  ownerIds: [process.env.REDPLASHE, process.env.MANUKQ],
  channelId: process.env.CHANNEL_ID,
  proposalsFile: 'proposals.json',
  maxImageSize: 5242880,
  messageDelay: 1000
};

let proposals = {};
const pendingRejections = {};

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

Я пипобот для пипосбора и пипообработки предложки.
Просто отправь своё предложение сюда, и я передам его на рассмотрение ))`;

  bot.sendMessage(msg.chat.id, welcome, { parse_mode: 'Markdown' });
});

bot.onText(/\/list/, async (msg) => {
  if (!config.ownerIds.includes(msg.chat.id.toString())) return;

  const proposalsList = Object.values(proposals)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (proposalsList.length === 0) {
    bot.sendMessage(msg.chat.id, '📝 Предложений пока нет.');
    return;
  }

  const chunks = [];
  let currentChunk = '📋 *Список предложений:*\n\n';

  for (const proposal of proposalsList) {
    const date = new Date(proposal.timestamp).toLocaleString('ru-RU');
    const status = {
      'pending': '⏳ Ожидает',
      'accepted': '✅ Принято',
      'rejected': '❌ Отклонено'
    }[proposal.status];

    const proposalText = `ID: ${proposal.id}\nСтатус: ${status}\nДата: ${date}\nТекст: ${proposal.text}${proposal.rejectionReason ? `\nПричина отказа: ${proposal.rejectionReason}` : ''}\n\n`;

    if (currentChunk.length + proposalText.length > 4000) {
      chunks.push(currentChunk);
      currentChunk = proposalText;
    } else {
      currentChunk += proposalText;
    }
  }
  chunks.push(currentChunk);

  for (const chunk of chunks) {
    await bot.sendMessage(msg.chat.id, chunk, { parse_mode: 'Markdown' });
    await new Promise(resolve => setTimeout(resolve, 500));
  }
});

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;

  const chatId = msg.chat.id;

  if (pendingRejections[msg.from.id]) {
    const proposalKey = pendingRejections[msg.from.id];
    if (proposals[proposalKey]?.status === 'pending') {
      proposals[proposalKey].status = 'rejected';
      proposals[proposalKey].rejectionReason = msg.text;
      proposals[proposalKey].rejectedAt = new Date().toISOString();
      saveProposals();
      
      bot.sendMessage(proposals[proposalKey].senderId, 
        `❌ Ваше предложение отклонено.\n*Причина:* ${msg.text}`,
        { parse_mode: 'Markdown' });
      bot.sendMessage(msg.from.id, '✅ Предложение отклонено.');
    }
    delete pendingRejections[msg.from.id];
    return;
  }

  const proposalKey = `${chatId}_${msg.message_id}`;
  let fileId = null;

  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    if (photo.file_size > config.maxImageSize) {
      bot.sendMessage(chatId, '⚠️ Изображение слишком большое. Максимальный размер: 5MB');
      return;
    }
    fileId = photo.file_id;
  }

  proposals[proposalKey] = {
    id: proposalKey,
    senderId: chatId,
    text: msg.text || msg.caption,
    fileId: fileId,
    status: 'pending',
    timestamp: new Date().toISOString()
  };
  
  saveProposals();

  const opts = {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Принять', callback_data: `accept_${chatId}_${msg.message_id}` },
        { text: '❌ Отклонить', callback_data: `reject_${chatId}_${msg.message_id}` }
      ]],
    },
    parse_mode: 'Markdown'
  };

  for (const ownerId of config.ownerIds) {
    const message = `📫 *Новое предложение*\n\nТекст: ${msg.text || msg.caption || 'Изображение без описания'}`;
    
    if (fileId) {
      await bot.sendPhoto(ownerId, fileId, { caption: message, ...opts });
    } else {
      await bot.sendMessage(ownerId, message, opts);
    }
  }

  bot.sendMessage(chatId, '📤 Ваше предложение отправлено!');
});

bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const [action, userChatId, messageId] = callbackQuery.data.split('_');
  const proposalKey = `${userChatId}_${messageId}`;
  
  await bot.answerCallbackQuery(callbackQuery.id);
  
  if (!proposals[proposalKey] || proposals[proposalKey].status !== 'pending') {
    await bot.sendMessage(callbackQuery.from.id, '⚠️ Это предложение уже обработано.');
    return;
  }
  
  if (action === 'accept') {
    try {
      const proposal = proposals[proposalKey];

      if (proposal.fileId) {
        await bot.sendPhoto(config.channelId, proposal.fileId, {
          caption: proposal.text,
          parse_mode: 'Markdown'
        });
      } else {
        await bot.sendMessage(config.channelId, proposal.text, {
          parse_mode: 'Markdown'
        });
      }

      proposal.status = 'accepted';
      proposal.acceptedAt = new Date().toISOString();
      saveProposals();

      await bot.sendMessage(userChatId, '🎉 Ваше предложение принято и опубликовано!');

      const editOpts = {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reply_markup: { inline_keyboard: [] }
      };

      if (proposal.fileId) {
        await bot.editMessageCaption('✅ Предложение опубликовано.', editOpts);
      } else {
        await bot.editMessageText('✅ Предложение опубликовано.', editOpts);
      }
    } catch (err) {
      await bot.sendMessage(callbackQuery.from.id, '⚠️ Ошибка публикации. Проверьте настройки канала.');
    }
  } else if (action === 'reject') {
    pendingRejections[callbackQuery.from.id] = proposalKey;
    await bot.sendMessage(callbackQuery.from.id, '📝 Укажите причину отклонения:',
      { reply_markup: { force_reply: true } }
    );

    const editOpts = {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      reply_markup: { inline_keyboard: [] }
    };

    if (proposals[proposalKey].fileId) {
      await bot.editMessageCaption('⏳ Ожидание причины отклонения...', editOpts);
    } else {
      await bot.editMessageText('⏳ Ожидание причины отклонения...', editOpts);
    }
  }
});

process.on('uncaughtException', err => console.error('Ошибка:', err));
process.on('unhandledRejection', err => console.error('Отклонённый промис:', err));

console.log('🤖 Бот запущен');
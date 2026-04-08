require('dotenv').config();

const { Telegraf, Markup, session } = require('telegraf');

// Initialize bot with token from environment variables
const botToken = process.env.BOT_TOKEN;
const managerChatId = process.env.MANAGER_CHAT_ID;

if (!botToken) {
  console.error('BOT_TOKEN is not set in .env file');
  process.exit(1);
}

if (!managerChatId) {
  console.error('MANAGER_CHAT_ID is not set in .env file');
  process.exit(1);
}

const bot = new Telegraf(botToken);

// Session middleware
bot.use(
  session({
    defaultSession: () => ({
      name: '',
      phone: '',
      interest: '',
      step: null,
    }),
  })
);

// Format username
function formatUsername(from) {
  if (from && from.username) {
    return `@${from.username}`;
  }
  return 'нет username';
}

// Confirmation message
async function sendConfirmation(ctx) {
  const { name, phone, interest } = ctx.session;

  const text =
    'Проверьте заявку:\n\n' +
    `Имя: ${name}\n` +
    `Телефон: ${phone}\n` +
    `Интересует: ${interest}`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Отправить заявку', 'confirm_send')],
    [Markup.button.callback('✏️ Изменить', 'edit_form')],
  ]);

  ctx.session.step = 'confirm';
  await ctx.reply(text, keyboard);
}

// Interest keyboard
function askInterest(ctx) {
  const message =
    'Что вас интересует?\n\n' +
    'Выберите категорию или напишите свой вариант:';

  const keyboard = Markup.keyboard([
    ['Полотенцесушители', 'Радиаторы', 'Раковины'],
    ['Унитазы', 'Аксессуары для ванны', 'Ванны'],
    ['Фильтры', 'Кафель', 'Смесители'],
    ['Лестницы', 'Аксессуары для пожилых'],
  ])
    .oneTime()
    .resize();

  return ctx.reply(message, keyboard);
}

// Start command
bot.start(async (ctx) => {
  ctx.session = {
    name: '',
    phone: '',
    interest: '',
    step: null,
  };

  const greetingText =
    'Здравствуйте! 👋\n' +
    'Добро пожаловать в магазин Perfect Home.\n\n' +
    'Чтобы оставить заявку, ответьте на 3 вопроса.';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Начать', 'start_form')],
  ]);

  await ctx.reply(greetingText, keyboard);
});

// Start form button
bot.action('start_form', async (ctx) => {
  await ctx.answerCbQuery();

  ctx.session.name = '';
  ctx.session.phone = '';
  ctx.session.interest = '';
  ctx.session.step = 'name';

  await ctx.reply('Как вас зовут?', Markup.removeKeyboard());
});

// Contact handler
bot.on('contact', async (ctx) => {
  if (!ctx.session || ctx.session.step !== 'phone') return;

  const contact = ctx.message.contact;

  if (!contact || !contact.phone_number) {
    await ctx.reply('Не удалось получить номер. Пожалуйста, введите его вручную.');
    return;
  }

  ctx.session.phone = contact.phone_number.startsWith('+')
    ? contact.phone_number
    : `+${contact.phone_number}`;

  ctx.session.step = 'interest';

  await askInterest(ctx);
});

// Main text handler
bot.on('text', async (ctx) => {
  if (!ctx.session) return;

  const step = ctx.session.step;
  const text = ctx.message.text ? ctx.message.text.trim() : '';

  if (text.startsWith('/')) return;

  if (!step) {
    await ctx.reply(
      'Чтобы начать заполнение заявки, отправьте команду /start.',
      Markup.removeKeyboard()
    );
    return;
  }

  if (step === 'name') {
    if (!text) {
      await ctx.reply('Пожалуйста, напишите ваше имя.');
      return;
    }

    ctx.session.name = text.slice(0, 80);
    ctx.session.step = 'phone';

    const keyboard = Markup.keyboard([
      [Markup.button.contactRequest('📲 Отправить мой номер')],
    ])
      .oneTime()
      .resize();

    await ctx.reply(
      'Отправьте номер телефона\n(пример: +998901234567)',
      keyboard
    );

    return;
  }

  if (step === 'phone') {
    if (!text) {
      await ctx.reply(
        'Пожалуйста, отправьте номер или используйте кнопку.',
        Markup.keyboard([[Markup.button.contactRequest('📲 Отправить мой номер')]])
          .oneTime()
          .resize()
      );
      return;
    }

    ctx.session.phone = text.slice(0, 30);
    ctx.session.step = 'interest';

    await askInterest(ctx);
    return;
  }

  if (step === 'interest') {
    if (!text) {
      await ctx.reply('Пожалуйста, укажите что вас интересует.');
      return;
    }

    ctx.session.interest = text.slice(0, 120);

    await ctx.reply('Отлично!', Markup.removeKeyboard());
    await sendConfirmation(ctx);
    return;
  }

  if (step === 'confirm') {
    await ctx.reply('Пожалуйста, используйте кнопки ниже.');
    return;
  }

  await ctx.reply('Произошла ошибка. Напишите /start чтобы начать заново.');
  ctx.session.step = null;
});

// Confirm send
bot.action('confirm_send', async (ctx) => {
  await ctx.answerCbQuery();

  if (ctx.session.step !== 'confirm') return;

  const { name, phone, interest } = ctx.session;

  if (!name || !phone || !interest) {
    await ctx.reply('Данные заявки неполные. Напишите /start.');
    ctx.session.step = null;
    return;
  }

  const from = ctx.from;
  const usernameText = formatUsername(from);
  const userId = from ? from.id : 'нет ID';

  const managerText =
    '📩 НОВАЯ ЗАЯВКА\n\n' +
    `👤 Имя: ${name}\n` +
    `📞 Телефон: ${phone}\n` +
    `🛒 Интересует: ${interest}\n\n` +
    `🔗 Telegram: ${usernameText}\n` +
    `🆔 ID: ${userId}`;

  try {
    await ctx.telegram.sendMessage(managerChatId, managerText);
  } catch (error) {
    console.error('Failed to send lead:', error);
    await ctx.reply('Ошибка отправки заявки. Попробуйте позже.');
    return;
  }

  ctx.session.step = null;

  await ctx.reply(
    'Спасибо! ✅\n\nЗаявка отправлена.\nМенеджер свяжется с вами в ближайшее время.',
    Markup.removeKeyboard()
  );
});

// Edit form
bot.action('edit_form', async (ctx) => {
  await ctx.answerCbQuery();

  ctx.session.name = '';
  ctx.session.phone = '';
  ctx.session.interest = '';
  ctx.session.step = 'name';

  await ctx.reply(
    'Давайте начнём заново.\n\nКак вас зовут?',
    Markup.removeKeyboard()
  );
});

// Global error handler
bot.catch((err, ctx) => {
  console.error(`Bot error for update ${ctx.updateType}:`, err);
});

// Webhook server
const http = require('http');

const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN;
const WEBHOOK_PATH = '/webhook';

if (!WEBHOOK_DOMAIN) {
  console.error('WEBHOOK_DOMAIN is not set in environment variables');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Webhook endpoint
  if (req.method === 'POST' && req.url === WEBHOOK_PATH) {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const update = JSON.parse(body);
        await bot.handleUpdate(update);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Failed to handle update:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      }
    });

    req.on('error', (err) => {
      console.error('Request error:', err);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    });

    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Explicitly register the webhook with Telegram before launching
async function registerWebhook() {
  const webhookUrl = `${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`;
  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Webhook successfully set to: ${webhookUrl}`);
  } catch (err) {
    console.error('Failed to set webhook:', err);
    process.exit(1);
  }
}

// Launch bot in webhook mode
registerWebhook().then(() => {
  bot
    .launch({
      webhook: {
        domain: WEBHOOK_DOMAIN,
        port: PORT,
        path: WEBHOOK_PATH,
        cb: server,
      },
    })
    .then(() => {
      console.log(`Telegram lead bot is running in webhook mode on port ${PORT}`);
      console.log(`Webhook active at ${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`);
    })
    .catch((err) => {
      console.error('Failed to launch bot:', err);
      process.exit(1);
    });
});

// Crash protection
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
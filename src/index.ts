import { Telegraf, Markup, Context } from 'telegraf';
import * as dotenv from 'dotenv';
import * as data from './data.json';

// Load environment variables
dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN must be provided in .env file');
}

// Create bot instance
const bot = new Telegraf(BOT_TOKEN);

// User state storage for questionnaire
interface UserState {
  loanAmount?: string;
  creditHistory?: string;
}

const userStates: Map<number, UserState> = new Map();

// Helper function to build link with user data
function buildLink(baseLink: string, ctx: Context): string {
  const userId = ctx.from?.id || '';
  const username = ctx.from?.username || '';
  const name = ctx.from?.first_name || '';
  
  return `${baseLink}&uid=${userId}&alias=${username}&name=${encodeURIComponent(name)}`;
}

// Helper function to get user's first name
function getUserName(ctx: Context): string {
  return ctx.from?.first_name || 'друг';
}

// Bot name constant
const BOT_NAME = 'ЗаймиБот';

// Helper function to replace %username% with actual user name
function replaceUsername(text: string, ctx: Context): string {
  const name = getUserName(ctx);
  return text.replace(/%username%/g, name);
}

// Helper function to replace all placeholders in text
function replacePlaceholders(text: string, ctx: Context, additionalReplacements?: Record<string, string>): string {
  let result = text;
  
  // Replace %username%
  const name = getUserName(ctx);
  result = result.replace(/%username%/g, name);
  
  // Replace %namebot%
  result = result.replace(/%namebot%/g, BOT_NAME);
  
  // Replace any additional placeholders (including %sumuser%)
  if (additionalReplacements) {
    Object.entries(additionalReplacements).forEach(([key, value]) => {
      result = result.replace(new RegExp(key, 'g'), value);
    });
  }
  
  return result;
}

// Command: /start
bot.start((ctx) => {
  const message = replacePlaceholders(data.startMsg, ctx);
  
  ctx.replyWithAnimation(
    'https://media1.tenor.com/m/4EElxXeHiZwAAAAC/forrest-gump-wave.gif',
    {
      caption: message,
      ...Markup.inlineKeyboard([
        [Markup.button.callback(data.startButtonName, 'start_questionnaire')]
      ])
    }
  );
});

// Handle "Начнём" button click
bot.action('start_questionnaire', (ctx) => {
  ctx.answerCbQuery();
  
  ctx.replyWithPhoto(
    'https://img.vedu.ru/office-woman-660-1.jpg',
    {
      caption: data.startSeconfMsg,
      ...Markup.inlineKeyboard(
        data.startSum.map((item) => 
          [Markup.button.callback(item.button, `amount_${item.sum}`)]
        )
      )
    }
  );
});

// Handle loan amount selection
bot.action(/^amount_(.+)$/, (ctx) => {
  ctx.answerCbQuery();
  
  const userId = ctx.from?.id;
  if (!userId) return;
  
  const amount = ctx.match[1];
  const state = userStates.get(userId) || {};
  state.loanAmount = amount;
  userStates.set(userId, state);
  
  ctx.reply(
    data.startThirdfMsg,
    Markup.inlineKeyboard([
      ...data.historyCredit.map((item) => 
        [Markup.button.callback(item.name, `credit_${item.status}`)]
      ),
      [Markup.button.callback('« Назад', 'start_questionnaire')]
    ])
  );
});

// Handle credit history selection
bot.action(/^credit_(.+)$/, (ctx) => {
  ctx.answerCbQuery();
  
  const userId = ctx.from?.id;
  if (!userId) return;
  
  const creditHistory = ctx.match[1];
  const state = userStates.get(userId) || {};
  state.creditHistory = creditHistory;
  userStates.set(userId, state);
  
  const link = buildLink(data.startAnketa, ctx);
  
  ctx.reply(
    `${data.startFourthMsg}\n\n👉 ${link}`,
    Markup.inlineKeyboard([
      [Markup.button.url(data.startFourthButton, link)],
      [Markup.button.callback('« Назад', 'back_to_amount')]
    ])
  );
});

// Handle back to amount selection
bot.action('back_to_amount', (ctx) => {
  ctx.answerCbQuery();
  
  ctx.reply(
    data.startSeconfMsg,
    Markup.inlineKeyboard(
      data.startSum.map((item) => 
        [Markup.button.callback(item.button, `amount_${item.sum}`)]
      )
    )
  );
});

// Command: /day
bot.command('day', (ctx) => {
  const dayOffer = data.day;
  const link = buildLink(dayOffer.link, ctx);
  const message = replacePlaceholders(dayOffer.text, ctx, {
    '%sumuser%': `до ${dayOffer.amount} ₽`
  });
  
  ctx.reply(
    `${message}\n\n👉 ${link}`,
    Markup.inlineKeyboard([
      [Markup.button.url(dayOffer.startButtonName, link)]
    ])
  );
});

// Command: /week
bot.command('week', (ctx) => {
  const weekOffer = data.week;
  const link = buildLink(weekOffer.link, ctx);
  const message = replacePlaceholders(weekOffer.text, ctx, {
    '%sumuser%': `до ${weekOffer.amount} ₽`
  });
  
  ctx.reply(
    `${message}\n\n👉 ${link}`,
    Markup.inlineKeyboard([
      [Markup.button.url(weekOffer.startButtonName, link)]
    ])
  );
});

// Command: /how
bot.command('how', (ctx) => {
  const howOffer = data.how;
  const link = buildLink(howOffer.link, ctx);
  
  ctx.reply(
    `${howOffer.textOne}\n\n👉 ${link}\n\n${howOffer.textSecond}`,
    Markup.inlineKeyboard([
      [Markup.button.url(howOffer.startButtonName, link)]
    ])
  );
});

// Command: /all
bot.command('all', (ctx) => {
  const allOffers = data.all;
  const buttons = allOffers.map((offer) => {
    const link = buildLink(offer.link, ctx);
    return [Markup.button.url(`💚 ${offer.name}`, link)];
  });
  
  let message = `${data.textOneAll}\n\n`;
  allOffers.forEach((offer, index) => {
    message += `${index + 1}. ${offer.name}\n`;
  });
  message += `\n${data.textSecondAll}`;
  
  ctx.reply(message, Markup.inlineKeyboard(buttons));
});

// Command: /insurance
bot.command('insurance', (ctx) => {
  ctx.reply(data.insuranceText);
  
  // Send the insurance return PDF document
  ctx.replyWithDocument({ source: './src/files/insurance_return.pdf' });
});

// Handle any other text message
bot.on('text', (ctx) => {
  ctx.reply(
    'Выберите команду из меню:\n\n' +
    '💚 /day - Займ дня\n' +
    '💚 /week - Займ недели\n' +
    '💚 /how - Как получить деньги\n' +
    '💚 /all - Все предложения\n' +
    '💚 /insurance - Отказ от страховки\n' +
    '💚 /start - Начать заново'
  );
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply('Произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте снова.');
});

// Set bot commands menu
bot.telegram.setMyCommands([
  { command: 'start', description: '🖐 Начать работу с ботом' },
  { command: 'day', description: '💚 Займ дня' },
  { command: 'week', description: '💚 Займ недели' },
  { command: 'how', description: '💡 Как получить деньги' },
  { command: 'all', description: '📋 Все предложения по рейтингу' },
  { command: 'insurance', description: '🛡 Отказ от страховки' }
]);

// Start the bot
bot.launch().then(() => {
  console.log('✅ Бот запущен и готов к работе!');
  console.log('✅ Меню команд установлено');
  console.log('Нажмите Ctrl+C для остановки');
});

// Enable graceful stop
process.once('SIGINT', () => {
  console.log('\n⏹ Остановка бота...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('\n⏹ Остановка бота...');
  bot.stop('SIGTERM');
});

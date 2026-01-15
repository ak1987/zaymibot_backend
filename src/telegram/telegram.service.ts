import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Telegraf, Markup, Context } from 'telegraf';
import { TelegramBotData } from './telegram-data.interface';
import * as data from './data.json';
import * as path from 'path';
import * as fs from 'fs';
import { BinomService } from '../binom/binom.service';

// User state storage for questionnaire
interface UserState {
  loanAmount?: string;
  creditHistory?: string;
  binomAdid?: string; // Telegram channel name from deeplink
  binomSub2?: string; // User Telegram alias
  binomAddinfo?: string; // Button title (optional)
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf;
  private userStates: Map<number, UserState> = new Map();
  private readonly BOT_NAME = 'ЗаймиБот';
  private readonly verboseLogs: boolean;

  constructor(private readonly binomService: BinomService) {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    
    if (!BOT_TOKEN) {
      throw new Error('BOT_TOKEN must be provided in .env file');
    }

    this.verboseLogs = (process.env.TG_VERBOSE_LOGS === 'true' || process.env.TG_VERBOSE_LOGS === '1');

    this.bot = new Telegraf(BOT_TOKEN);
    this.setupBotHandlers();
  }

  onModuleInit() {
    this.startBot();
  }

  onModuleDestroy() {
    this.stopBot();
  }

  private setupBotHandlers() {
    // Command: /start
    this.bot.start((ctx) => {
      const user = this.getUserIdentifier(ctx);
      const userId = ctx.from?.id;
      
      // Extract deep link payload (?start=payload)
      // Telegram sends /start payload when user clicks https://t.me/botname?start=payload
      // Format: ch_telegramchanelname__foo_bar
      // Split by __ to get key-value pairs, then split by _ to separate key and value
      let payload: string | null = null;
      if (ctx.message && 'text' in ctx.message && ctx.message.text) {
        const parts = ctx.message.text.split(' ');
        if (parts.length > 1) {
          payload = parts.slice(1).join(' ');
        }
      }
      
      // Parse deeplink payload
      if (payload && userId) {
        this.verboseLog(`User ${user} executed /start command with payload: ${payload}`);
        
        // Parse deeplink: ch_telegramchanelname__foo_bar
        // Split by __ to get pairs
        const pairs = payload.split('__');
        const state = this.userStates.get(userId) || {};
        
        pairs.forEach((pair) => {
          // Split by _ to separate key and value
          // Underscores are strictly separators, never used in keys or values
          const parts = pair.split('_');
          if (parts.length === 2) {
            const key = parts[0];
            const value = parts[1];
            
            // Map deeplink keys to binom data
            if (key === 'ch') {
              // ch_telegramchanelname -> adid = telegramchanelname
              state.binomAdid = value;
            } else if (key === 'sub2') {
              state.binomSub2 = value;
            } else if (key === 'addinfo') {
              state.binomAddinfo = value;
            }
          }
        });
        
        // Set sub2 to user's Telegram alias if not provided in deeplink
        if (!state.binomSub2) {
          state.binomSub2 = ctx.from?.username || String(userId);
        }
        
        this.userStates.set(userId, state);
        this.verboseLog(`User ${user} parsed deeplink - adid: ${state.binomAdid}, sub2: ${state.binomSub2}, addinfo: ${state.binomAddinfo}`);
      } else {
        this.verboseLog(`User ${user} executed /start command`);
        
        // Initialize state with default sub2 if no deeplink
        if (userId) {
          const state = this.userStates.get(userId) || {};
          state.binomSub2 = ctx.from?.username || String(userId);
          this.userStates.set(userId, state);
        }
      }
      
      const message = this.replacePlaceholders((data as TelegramBotData).startMsg, ctx);
      
      ctx.replyWithAnimation(
        'https://media1.tenor.com/m/4EElxXeHiZwAAAAC/forrest-gump-wave.gif',
        {
          caption: message,
          ...Markup.inlineKeyboard([
            [Markup.button.callback((data as TelegramBotData).startButtonName, 'start_questionnaire')]
          ])
        }
      );
    });

    // Handle "Начнём" button click
    this.bot.action('start_questionnaire', async (ctx) => {
      await this.safeAnswerCbQuery(ctx);
      
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} clicked start_questionnaire button`);
      
      const buttonNameEn = (data as TelegramBotData).startButtonNameEn;
      
      // Call binom tracking (fire-and-forget, wrapped in try-catch to prevent breaking button)
      try {
        this.trackButtonClick(ctx, buttonNameEn);
      } catch (error) {
        this.logger.error('Error in trackButtonClick:', error);
      }
      
      ctx.replyWithPhoto(
        'https://img.vedu.ru/office-woman-660-1.jpg',
        {
          caption: (data as TelegramBotData).secondMsg,
          ...Markup.inlineKeyboard(
            (data as TelegramBotData).sum.map((item) => 
              [Markup.button.callback(item.buttonName, `amount_${item.sum}`)]
            )
          )
        }
      );
    });

    // Handle loan amount selection
    this.bot.action(/^amount_(.+)$/, async (ctx) => {
      await this.safeAnswerCbQuery(ctx);
      
      const userId = ctx.from?.id;
      if (!userId) return;
      
      const amount = ctx.match[1];
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} selected loan amount ${amount}`);
      
      // Find button name from data (compare as strings to handle both number and string types)
      // Use English button name for addinfo to prevent UTF-8 encoding issues
      const buttonNameEn = (data as TelegramBotData).sum.find(item => String(item.sum) === amount)?.buttonNameEn || `amount_${amount}`;
      
      this.trackButtonClick(ctx, buttonNameEn);
      
      const state = this.userStates.get(userId) || {};
      state.loanAmount = amount;
      this.userStates.set(userId, state);
      
      ctx.reply(
        (data as TelegramBotData).thirdMsg,
        Markup.inlineKeyboard([
          ...(data as TelegramBotData).historyCredit.map((item) => 
            [Markup.button.callback(item.buttonName, `credit_${item.status}`)]
          ),
          [Markup.button.callback('« Назад', 'start_questionnaire')]
        ])
      );
    });

    // Handle credit history selection
    this.bot.action(/^credit_(.+)$/, async (ctx) => {
      await this.safeAnswerCbQuery(ctx);
      
      const userId = ctx.from?.id;
      if (!userId) return;
      
      const creditHistory = ctx.match[1];
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} selected credit history ${creditHistory}`);
      
      // Find button name from data (compare as strings to handle both number and string types)
      // Use English button name for addinfo to prevent UTF-8 encoding issues
      const buttonNameEn = (data as TelegramBotData).historyCredit.find(item => String(item.status) === creditHistory)?.buttonNameEn || `credit_${creditHistory}`;
      
      this.trackButtonClick(ctx, buttonNameEn);
      
      const state = this.userStates.get(userId) || {};
      state.creditHistory = creditHistory;
      this.userStates.set(userId, state);
      
      // Generate final link using binom - use English button name for addinfo
      const link = this.buildFinalLink(ctx, (data as TelegramBotData).fourthButtonEn);
      this.logger.log(`User ${user} clicked offer`);
      this.verboseLog(`User ${user} generated application link ${link}`);
      
      ctx.reply(
        `${(data as TelegramBotData).fourthMsg}\n\n👉 ${link}`,
        Markup.inlineKeyboard([
          [Markup.button.url((data as TelegramBotData).fourthButton, link)],
          [Markup.button.callback('« Назад', 'back_to_amount')]
        ])
      );
    });

    // Handle back to amount selection
    this.bot.action('back_to_amount', async (ctx) => {
      await this.safeAnswerCbQuery(ctx);
      
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} clicked back_to_amount button`);
      
      ctx.reply(
        (data as TelegramBotData).secondMsg,
        Markup.inlineKeyboard(
          (data as TelegramBotData).sum.map((item) => 
            [Markup.button.callback(item.buttonName, `amount_${item.sum}`)]
          )
        )
      );
    });

    // Command: /day
    this.bot.command('day', (ctx) => {
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} executed /day command`);
      
      const dayOffer = (data as TelegramBotData).day;
      const link = this.buildLink(dayOffer.link, ctx);
      this.verboseLog(`User ${user} generated day offer link ${link}`);
      
      const message = this.replacePlaceholders(dayOffer.text, ctx, {
        '%sumuser%': `до ${dayOffer.amount} ₽`
      });
      
      ctx.reply(
        `${message}\n\n👉 ${link}`,
        Markup.inlineKeyboard([
          [Markup.button.url(dayOffer.buttonName, link)]
        ])
      );
    });

    // Command: /week
    this.bot.command('week', (ctx) => {
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} executed /week command`);
      
      const weekOffer = (data as TelegramBotData).week;
      const link = this.buildLink(weekOffer.link, ctx);
      this.verboseLog(`User ${user} generated week offer link ${link}`);
      
      const message = this.replacePlaceholders(weekOffer.text, ctx, {
        '%sumuser%': `до ${weekOffer.amount} ₽`
      });
      
      ctx.reply(
        `${message}\n\n👉 ${link}`,
        Markup.inlineKeyboard([
          [Markup.button.url(weekOffer.buttonName, link)]
        ])
      );
    });

    // Command: /how
    this.bot.command('how', (ctx) => {
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} executed /how command`);
      
      const howOffer = (data as TelegramBotData).how;
      const link = this.buildLink(howOffer.link, ctx);
      this.verboseLog(`User ${user} generated how offer link ${link}`);
      
      ctx.reply(
        `${howOffer.textOne}\n\n👉 ${link}\n\n${howOffer.textSecond}`,
        Markup.inlineKeyboard([
          [Markup.button.url(howOffer.buttonName, link)]
        ])
      );
    });

    // Command: /all
    this.bot.command('all', (ctx) => {
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} executed /all command`);
      
      const allOffers = (data as TelegramBotData).all;
      const buttons = allOffers.map((offer) => {
        const link = this.buildLink(offer.link, ctx);
        return [Markup.button.url(`💚 ${offer.name}`, link)];
      });
      
      let message = `${(data as TelegramBotData).textOneAll}\n\n`;
      allOffers.forEach((offer, index) => {
        message += `${index + 1}. ${offer.name}\n`;
      });
      message += `\n${(data as TelegramBotData).textSecondAll}`;
      
      this.verboseLog(`User ${user} viewing all offers (${allOffers.length} total)`);
      
      ctx.reply(message, Markup.inlineKeyboard(buttons));
    });

    // Command: /insurance
    this.bot.command('insurance', async (ctx) => {
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} executed /insurance command`);
      
      ctx.reply((data as TelegramBotData).insuranceText);
      
      // Send the insurance return PDF document if it exists
      try {
        const pdfPath = path.join(process.cwd(), 'src', 'files', 'insurance_return.pdf');
        
        if (fs.existsSync(pdfPath)) {
          await ctx.replyWithDocument({ source: pdfPath });
          this.verboseLog(`User ${user} received insurance PDF document`);
        } else {
          this.logger.warn('Insurance PDF file not found at: ' + pdfPath);
          this.verboseLog(`User ${user} requested insurance PDF but file not found`);
        }
      } catch (error) {
        this.logger.error('Error sending insurance PDF:', error);
        this.verboseLog(`User ${user} encountered error while requesting insurance PDF`);
      }
    });

    // Handle any other text message
    this.bot.on('text', (ctx) => {
      const user = this.getUserIdentifier(ctx);
      const text = ctx.message?.text || '';
      this.verboseLog(`User ${user} sent text message "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      
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
    this.bot.catch((err, ctx) => {
      const user = this.getUserIdentifier(ctx);
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.verboseLog(`User ${user} encountered error in ${ctx.updateType} ${errorMessage}`);
      this.logger.error(`Error for ${ctx.updateType}:`, err);
      ctx.reply('Произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте снова.');
    });
  }

  private startBot() {
    // Set bot commands menu
    this.bot.telegram.setMyCommands([
      { command: 'start', description: '🖐 Начать работу с ботом' },
      { command: 'day', description: '💚 Займ дня' },
      { command: 'week', description: '💚 Займ недели' },
      { command: 'how', description: '💡 Как получить деньги' },
      { command: 'all', description: '📋 Все предложения по рейтингу' },
      { command: 'insurance', description: '🛡 Отказ от страховки' }
    ]);

    // Start the bot
    this.bot.launch().then(() => {
      this.logger.log('✅ Бот запущен и готов к работе!');
      this.logger.log('✅ Меню команд установлено');
    }).catch((error) => {
      this.logger.error('Failed to start bot:', error);
    });
  }

  private stopBot() {
    this.logger.log('⏹ Остановка бота...');
    this.bot.stop('SIGTERM');
  }

  // Helper function to build link with user data
  private buildLink(baseLink: string, ctx: Context): string {
    const userId = ctx.from?.id || '';
    const username = ctx.from?.username || '';
    const name = ctx.from?.first_name || '';
    
    let link = `${baseLink}&uid=${userId}&alias=${username}&name=${encodeURIComponent(name)}`;
    
    // Add binom parameters if available
    const binomSource = process.env.BINOM_SOURCE;
    if (userId) {
      const state = this.userStates.get(userId);
      if (state) {
        // Add source parameter - use state.binomSub2 which has fallback to userId
        if (binomSource) {
          const sub2 = state.binomSub2 || String(userId);
          link += `&source=${binomSource}&sub2=${sub2}`;
        }
        // Add adid parameter (from deeplink)
        if (state.binomAdid) {
          link += `&adid=${state.binomAdid}`;
        } else {
          link += `&adid=`;
        }
        // Add addinfo parameter (from deeplink or button name)
        if (state.binomAddinfo) {
          link += `&addinfo=${state.binomAddinfo}`;
        } else {
          link += `&addinfo=`;
        }
      } else {
        // If no state, use username or userId as fallback for sub2
        if (binomSource) {
          const sub2 = username || String(userId);
          link += `&source=${binomSource}&sub2=${sub2}`;
        }
        link += `&adid=&addinfo=`;
      }
    } else {
      // If no userId, add empty parameters
      if (binomSource) {
        link += `&source=${binomSource}&sub2=`;
      }
      link += `&adid=&addinfo=`;
    }
    
    return link;
  }

  // Helper function to build final link using binom
  private buildFinalLink(ctx: Context, buttonName: string): string {
    const userId = ctx.from?.id;
    if (!userId) {
      return this.buildLink((data as TelegramBotData).startAnketa, ctx);
    }

    const state = this.userStates.get(userId);
    if (!state || !state.binomAdid || !state.binomSub2) {
      // Fallback to regular link if binom data is not available
      this.verboseLog(`User ${this.getUserIdentifier(ctx)}: binom data not available, using fallback link`);
      return this.buildLink((data as TelegramBotData).startAnketa, ctx);
    }

    // Always use binom to form the final URL
    const binomUrl = this.binomService.formUrl(
      state.binomAdid,
      state.binomSub2,
      buttonName
    );

    if (binomUrl) {
      this.verboseLog(`User ${this.getUserIdentifier(ctx)}: using binom link with adid=${state.binomAdid}, sub2=${state.binomSub2}`);
      return binomUrl;
    }

    // Fallback to regular link if binom URL formation fails
    this.logger.warn(`User ${this.getUserIdentifier(ctx)}: binom URL formation failed, using fallback link`);
    return this.buildLink((data as TelegramBotData).startAnketa, ctx);
  }

  // Helper function to track button clicks with binom
  // Fire-and-forget: we don't wait for the HTTP call to complete
  private trackButtonClick(ctx: Context, buttonName: string): void {
    try {
      const userId = ctx.from?.id;
      const user = this.getUserIdentifier(ctx);
      
      // Log button click
      this.logger.log(`User ${user} clicked button: ${buttonName}`);
      
      if (!userId) return;

      const state = this.userStates.get(userId);
      if (!state || !state.binomAdid || !state.binomSub2) {
        // Skip tracking if binom data is not available
        return;
      }

      // Form URL and make tracking call (fire-and-forget)
      const trackingUrl = this.binomService.formUrl(
        state.binomAdid,
        state.binomSub2,
        buttonName
      );

      if (trackingUrl) {
        // Call binom asynchronously without waiting
        this.binomService.httpCall(trackingUrl).catch((error) => {
          this.logger.error('Error in binom tracking call:', error);
        });
      }
    } catch (error) {
      // Silently catch any errors to prevent breaking button functionality
      this.logger.error('Error in trackButtonClick:', error);
    }
  }

  // Helper function to get user's first name
  private getUserName(ctx: Context): string {
    return ctx.from?.first_name || 'друг';
  }

  // Helper function to get user identifier for logging
  private getUserIdentifier(ctx: Context): string {
    const userId = ctx.from?.id;
    const alias = ctx.from?.username;
    
    if (!userId) {
      return 'unknown';
    }
    
    if (alias) {
      return `${userId}:${alias}`;
    }
    
    return String(userId);
  }

  // Helper function for verbose logging
  private verboseLog(message: string): void {
    if (this.verboseLogs) {
      this.logger.log(message);
    }
  }

  // Helper function to safely answer callback queries (handles expired queries)
  private async safeAnswerCbQuery(ctx: Context): Promise<void> {
    try {
      await ctx.answerCbQuery();
    } catch (error: any) {
      // Ignore errors for expired or invalid callback queries
      // This happens when server restarts and old buttons are clicked
      if (error?.response?.error_code === 400 && 
          error?.response?.description?.includes('query is too old')) {
        // Silently ignore expired queries
        return;
      }
      // Log other errors but don't throw to prevent breaking event loop
      this.logger.warn('Error answering callback query:', error?.message || error);
    }
  }

  // Helper function to replace all placeholders in text
  private replacePlaceholders(text: string, ctx: Context, additionalReplacements?: Record<string, string>): string {
    let result = text;
    
    // Replace %username%
    const name = this.getUserName(ctx);
    result = result.replace(/%username%/g, name);
    
    // Replace %namebot%
    result = result.replace(/%namebot%/g, this.BOT_NAME);
    
    // Replace any additional placeholders (including %sumuser%)
    if (additionalReplacements) {
      Object.entries(additionalReplacements).forEach(([key, value]) => {
        result = result.replace(new RegExp(key, 'g'), value);
      });
    }
    
    return result;
  }
}

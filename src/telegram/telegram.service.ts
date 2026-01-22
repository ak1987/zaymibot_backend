import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Telegraf, Markup, Context } from 'telegraf';
import { TelegramBotData } from './telegram-data.interface';
import { readFileSync, statSync } from 'fs';
import * as path from 'path';
import * as fs from 'fs';
import { BinomService } from '../binom/binom.service';
import { TelegramUsersService } from './telegram-users.service';

const CONFIG_PATH = '/data/data.json';

// Cache for data.json with modification time tracking
interface DataCache {
  data: TelegramBotData;
  mtimeMs: number;
}

let dataCache: DataCache = { data: {} as TelegramBotData, mtimeMs: 0 };

/**
 * Loads Telegram bot configuration from data.json file.
 * Uses in-memory cache and only reloads when the file modification time changes,
 * so changes to the file are automatically picked up on the next request
 * without requiring a container restart, while minimizing disk I/O.
 */
export function getTelegramData(): TelegramBotData {
  try {
    const stats = statSync(CONFIG_PATH);
    const currentMtimeMs = stats.mtimeMs;

    // Return cached data if file hasn't been modified (mtimeMs 0 ensures first load always happens)
    if (dataCache.mtimeMs === currentMtimeMs) {
      return dataCache.data;
    }

    // File has been modified or cache is empty (first launch) - reload
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const data = JSON.parse(raw) as TelegramBotData;

    // Update cache
    dataCache = {
      data,
      mtimeMs: currentMtimeMs,
    };

    return data;
  } catch (err) {
    console.error('Ошибка при чтении telegram.json:', err);
    throw new Error(`Failed to load telegram bot data: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// User state storage for questionnaire
interface UserState {
  loanAmount?: string;
  creditHistory?: string;
  binomAdid?: string; // Telegram channel name from deeplink
  binomSub2?: string; // User Telegram alias
  binomAddinfo?: string; // Button title (optional)
  lastMessageId?: number; // Last message ID for deletion
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf;
  private userStates: Map<number, UserState> = new Map();
  private readonly BOT_NAME = 'ЗаймиБот';
  private readonly verboseLogs: boolean;

  constructor(
    private readonly binomService: BinomService,
    private readonly telegramUsersService: TelegramUsersService,
  ) {
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
    this.bot.start(async (ctx) => {
      const user = this.getUserIdentifier(ctx);
      const userId = ctx.from?.id;
      
      // Track user on start (UPDATE if exists, CREATE if not)
      await this.trackUserFromContext(ctx);
      
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
      
      // Parse deeplink payload and initialize state
      if (payload && userId) {
        this.verboseLog(`User ${user} executed /start command with payload: ${payload}`);
        this.parseDeeplinkPayload(payload, userId, ctx);
      } else {
        this.verboseLog(`User ${user} executed /start command`);
        if (userId) {
          this.ensureUserStateInitialized(userId, ctx);
        }
      }
      
      // Track /start command to Binom (fire-and-forget, wrapped in try-catch to prevent breaking command)
      try {
        this.trackButtonClick(ctx, 'start');
      } catch (error) {
        this.logger.error('Error tracking /start command:', error);
      }
      
      const data = getTelegramData();
      const message = this.replacePlaceholders(data.startMsg, ctx);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(data.startButtonName, 'start_questionnaire')]
      ]);
      
      await this.sendMessageWithOptionalImage(ctx, message, keyboard, data.startMsgImg);
    });

    // Handle "Начнём" button click
    this.bot.action('start_questionnaire', async (ctx) => {
      await this.safeAnswerCbQuery(ctx);
      
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} clicked start_questionnaire button`);
      
      // Track user on button click
      await this.trackUserFromContext(ctx);
      
      const data = getTelegramData();
      const buttonNameEn = data.startButtonNameEn;
      
      // Call binom tracking (fire-and-forget, wrapped in try-catch to prevent breaking button)
      try {
        this.trackButtonClick(ctx, buttonNameEn);
      } catch (error) {
        this.logger.error('Error in trackButtonClick:', error);
      }
      
      const keyboard = Markup.inlineKeyboard(
        data.sum.map((item) => 
          [Markup.button.callback(item.buttonName, `amount_${item.sum}`)]
        )
      );
      
      await this.sendMessageWithOptionalImage(ctx, data.secondMsg, keyboard, data.secondMsgImg);
    });

    // Handle loan amount selection
    this.bot.action(/^amount_(.+)$/, async (ctx) => {
      await this.safeAnswerCbQuery(ctx);
      
      const userId = ctx.from?.id;
      if (!userId) return;
      
      // Track user on button click
      await this.trackUserFromContext(ctx);
      
      const amount = ctx.match[1];
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} selected loan amount ${amount}`);
      
      const data = getTelegramData();
      // Find button name from data (compare as strings to handle both number and string types)
      // Use English button name for addinfo to prevent UTF-8 encoding issues
      const buttonNameEn = data.sum.find(item => String(item.sum) === amount)?.buttonNameEn || `amount_${amount}`;
      
      this.trackButtonClick(ctx, buttonNameEn);
      
      const state = this.userStates.get(userId) || {};
      state.loanAmount = amount;
      this.userStates.set(userId, state);
      
      const keyboard = Markup.inlineKeyboard([
        ...data.historyCredit.map((item) => 
          [Markup.button.callback(item.buttonName, `credit_${item.status}`)]
        ),
        [Markup.button.callback('« Назад', 'start_questionnaire')]
      ]);
      
      await this.sendMessageWithOptionalImage(ctx, data.thirdMsg, keyboard, data.thirdMsgImg);
    });

    // Handle credit history selection
    this.bot.action(/^credit_(.+)$/, async (ctx) => {
      await this.safeAnswerCbQuery(ctx);
      
      const userId = ctx.from?.id;
      if (!userId) return;
      
      // Track user on button click
      await this.trackUserFromContext(ctx);
      
      const creditHistory = ctx.match[1];
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} selected credit history ${creditHistory}`);
      
      const data = getTelegramData();
      // Find button name from data (compare as strings to handle both number and string types)
      // Use English button name for addinfo to prevent UTF-8 encoding issues
      const buttonNameEn = data.historyCredit.find(item => String(item.status) === creditHistory)?.buttonNameEn || `credit_${creditHistory}`;
      
      this.trackButtonClick(ctx, buttonNameEn);
      
      const state = this.userStates.get(userId) || {};
      state.creditHistory = creditHistory;
      this.userStates.set(userId, state);
      
      // Generate final link using binom - use English button name for addinfo
      const link = this.buildFinalLink(ctx, data.fourthButtonEn);
      this.logger.log(`User ${user} clicked offer`);
      this.verboseLog(`User ${user} generated application link ${link}`);
      
      const message = `${data.fourthMsg}\n\n👉 ${link}`;
      const navigationButtons = this.getNavigationButtons();
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url(data.fourthButton, link)],
        [Markup.button.callback('« Назад', 'back_to_amount')],
        ...navigationButtons
      ]);
      
      await this.sendMessageWithOptionalImage(ctx, message, keyboard, data.fourthMsgImg);
    });

    // Handle back to amount selection
    this.bot.action('back_to_amount', async (ctx) => {
      await this.safeAnswerCbQuery(ctx);
      
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} clicked back_to_amount button`);
      
      // Track user on button click
      await this.trackUserFromContext(ctx);
      
      const data = getTelegramData();
      const keyboard = Markup.inlineKeyboard(
        data.sum.map((item) => 
          [Markup.button.callback(item.buttonName, `amount_${item.sum}`)]
        )
      );
      
      await this.sendMessageWithOptionalImage(ctx, data.secondMsg, keyboard, data.secondMsgImg);
    });

    // Handle navigation button clicks
    this.bot.action(/^nav_(.+)$/, async (ctx) => {
      await this.safeAnswerCbQuery(ctx);
      
      const command = ctx.match[1];
      const user = this.getUserIdentifier(ctx);
      this.verboseLog(`User ${user} clicked navigation button: ${command}`);
      
      // Track user on button click
      await this.trackUserFromContext(ctx);
      
      // Execute the corresponding command using map-based routing
      const commandHandlers: Record<string, (ctx: Context) => Promise<void>> = {
        day: this.handleDayCommand.bind(this),
        week: this.handleWeekCommand.bind(this),
        how: this.handleHowCommand.bind(this),
        all: this.handleAllCommand.bind(this),
        insurance: this.handleInsuranceCommand.bind(this),
      };

      const handler = commandHandlers[command];
      if (handler) {
        await handler(ctx);
      }
    });

    // Command: /day
    this.bot.command('day', async (ctx) => {
      await this.handleDayCommand(ctx);
    });

    // Command: /week
    this.bot.command('week', async (ctx) => {
      await this.handleWeekCommand(ctx);
    });

    // Command: /how
    this.bot.command('how', async (ctx) => {
      await this.handleHowCommand(ctx);
    });

    // Command: /all
    this.bot.command('all', async (ctx) => {
      await this.handleAllCommand(ctx);
    });

    // Command: /insurance
    this.bot.command('insurance', async (ctx) => {
      await this.handleInsuranceCommand(ctx);
    });

    // Handle any other text message
    this.bot.on('text', async (ctx) => {
      const user = this.getUserIdentifier(ctx);
      const text = ctx.message?.text || '';
      this.verboseLog(`User ${user} sent text message "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      
      // Track user on text message
      await this.trackUserFromContext(ctx);
      
      await this.sendMessageAndSaveId(
        ctx,
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

  // Helper function to get binom parameters from user state (DRY principle)
  private getBinomParams(userId: number | undefined, username: string, userName: string): {
    adid: string;
    sub2: string;
  } {
    const state = userId ? this.userStates.get(userId) : undefined;
    const sub2 = state?.binomSub2 || (userId ? (username || String(userId)) : '');
    const adid = state?.binomAdid || '';
    
    return { adid, sub2 };
  }

  // Helper function to build link with user data
  // Simply adds GET parameters to existing URL (preserves domain and path)
  // addinfoOverride: if provided, use it instead of user name (for menu offers)
  private buildLink(baseLink: string, ctx: Context, addinfoOverride?: string): string {
    const userId = ctx.from?.id;
    const username = ctx.from?.username || '';
    const name = ctx.from?.first_name || ''; // Telegram user name (not alias)
    
    // Get binom parameters (DRY - extracted to avoid duplication)
    // addinfo = addinfoOverride (button name for menu) or Telegram user name (first_name), can be empty
    const { adid, sub2 } = this.getBinomParams(userId, username, name);
    const addinfo = addinfoOverride !== undefined ? addinfoOverride : name;
    
    try {
      // Use URL class to properly handle baseLink (with or without existing parameters)
      const url = new URL(baseLink);
      
      // Add non-binom parameters (uid, alias, name)
      url.searchParams.set('uid', String(userId || ''));
      url.searchParams.set('alias', username);
      url.searchParams.set('name', name);
      
      // Add binom parameters to existing URL (preserves domain, path, existing params)
      // addBinomParamsToUrl uses URL class internally, so it properly handles ? vs &
      const linkWithBinom = this.binomService.addBinomParamsToUrl(
        url.toString(),
        adid,
        sub2,
        addinfo,
        userId || undefined
      );
      
      return linkWithBinom;
    } catch (error) {
      // Fallback: manually check for ? to use & or ?
      this.logger.warn(`Failed to parse baseLink as URL: ${baseLink}, using string concatenation`);
      const separator = baseLink.includes('?') ? '&' : '?';
      let link = `${baseLink}${separator}uid=${userId || ''}&alias=${encodeURIComponent(username)}&name=${encodeURIComponent(name)}`;
      
      // Add binom parameters (check again for ? after adding uid/alias/name)
      link = this.binomService.addBinomParamsToUrl(link, adid, sub2, addinfo, userId || undefined);
      return link;
    }
  }

  // Helper function to build final link using binom
  // Simply adds binom GET parameters to startAnketa URL (preserves domain and path)
  private buildFinalLink(ctx: Context, buttonName: string): string {
    const data = getTelegramData();
    const userId = ctx.from?.id;
    if (!userId) {
      return this.buildLink(data.startAnketa, ctx);
    }

    // Check if binom tracking data is available (DRY principle)
    if (!this.hasBinomTrackingData(userId)) {
      // Fallback to regular link if binom data is not available
      this.verboseLog(`User ${this.getUserIdentifier(ctx)}: binom data not available, using fallback link`);
      return this.buildLink(data.startAnketa, ctx);
    }

    const state = this.userStates.get(userId);

    // Use startAnketa as base URL and simply add binom parameters to it
    // This preserves the original URL from data.json (domain, path, existing params)
    // addBinomParamsToUrl uses URL class internally, so it properly handles ? vs &
    const baseUrl = data.startAnketa;
    const adid = state.binomAdid || '';
    const sub2 = state.binomSub2;
    // addinfo = Telegram user name (first_name), not alias, can be empty
    // Button name is used ONLY for tracker, not for user-facing links
    const userName = ctx.from?.first_name || '';
    const addinfo = userName;
    
    // Add binom parameters to the startAnketa URL (preserves domain)
    const binomUrl = this.binomService.addBinomParamsToUrl(
      baseUrl,
      adid,
      sub2,
      addinfo,
      userId
    );

    if (binomUrl) {
      this.verboseLog(`User ${this.getUserIdentifier(ctx)}: using binom link with adid=${adid}, sub2=${sub2}, baseUrl=${baseUrl}`);
      return binomUrl;
    }

    // Fallback to regular link if binom URL formation fails
    this.logger.warn(`User ${this.getUserIdentifier(ctx)}: binom URL formation failed, using fallback link`);
    return this.buildLink(data.startAnketa, ctx);
  }

  // Internal method to track events with binom (DRY principle)
  // Fire-and-forget: we don't wait for the HTTP call to complete
  private trackEvent(ctx: Context, addinfo: string, logMessage: string): void {
    try {
      const userId = ctx.from?.id;
      
      // Log event
      this.logger.log(logMessage);
      
      if (!this.hasBinomTrackingData(userId)) {
        // Skip tracking if binom data is not available
        return;
      }

      const state = this.userStates.get(userId!);
      // Form URL and make tracking call (fire-and-forget)
      const trackingUrl = this.binomService.formTrackingUrl(
        state.binomAdid!,
        state.binomSub2!,
        addinfo,
        userId!
      );

      if (trackingUrl) {
        // Call binom asynchronously without waiting
        this.binomService.httpCall(trackingUrl).catch((error) => {
          this.logger.error('Error in binom tracking call:', error);
        });
      }
    } catch (error) {
      // Silently catch any errors to prevent breaking functionality
      this.logger.error('Error in trackEvent:', error);
    }
  }

  // Helper function to check if binom tracking data is available (DRY principle)
  private hasBinomTrackingData(userId: number | undefined): boolean {
    if (!userId) return false;
    const state = this.userStates.get(userId);
    // Allow empty adid (for /start without deeplink) but require sub2
    return !!(state && state.binomAdid !== undefined && state.binomAdid !== null && state.binomSub2);
  }

  // Helper function to track button clicks with binom
  // addinfo = button name
  private trackButtonClick(ctx: Context, buttonName: string): void {
    const user = this.getUserIdentifier(ctx);
    this.trackEvent(ctx, buttonName, `User ${user} clicked button: ${buttonName}`);
  }

  // Helper function to track offer link clicks with binom
  // addinfo = button name (for menu buttons: day, week, how, all)
  private trackOfferClick(ctx: Context, buttonName: string): void {
    const user = this.getUserIdentifier(ctx);
    this.trackEvent(ctx, buttonName, `User ${user} clicked offer button: ${buttonName}`);
  }

  // Helper function to track Telegram user (update if exists, create if not)
  private async trackTelegramUser(userId: number, alias?: string | null): Promise<void> {
    try {
      const affectedRows = await this.telegramUsersService.updateUser(userId, alias);
      if (affectedRows === 0) {
        await this.telegramUsersService.createUser(userId, alias);
      }
    } catch (error) {
      this.logger.error('Error tracking Telegram user:', error);
    }
  }

  // Helper function to track user from context (extracts userId and username automatically)
  private async trackUserFromContext(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (userId) {
      await this.trackTelegramUser(userId, ctx.from?.username || null);
    }
  }

  // Helper function to parse deeplink payload and update user state
  private parseDeeplinkPayload(payload: string, userId: number, ctx: Context): void {
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
    
    // Ensure required state fields are set
    this.ensureUserStateInitialized(userId, ctx);
    
    const user = this.getUserIdentifier(ctx);
    this.verboseLog(`User ${user} parsed deeplink - adid: ${state.binomAdid}, sub2: ${state.binomSub2}, addinfo: ${state.binomAddinfo}`);
  }

  // Helper function to ensure user state is initialized with default values
  private ensureUserStateInitialized(userId: number, ctx: Context): void {
    const state = this.userStates.get(userId) || {};
    
    // Set sub2 to user's Telegram alias if not already set
    if (!state.binomSub2) {
      state.binomSub2 = ctx.from?.username || String(userId);
    }
    
    // Set empty adid if not already set (to allow Binom tracking)
    if (state.binomAdid === undefined || state.binomAdid === null) {
      state.binomAdid = '';
    }
    
    this.userStates.set(userId, state);
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

  // Helper function to delete previous message if exists
  private async deletePreviousMessage(ctx: Context, userId: number): Promise<void> {
    try {
      const state = this.userStates.get(userId);
      if (state?.lastMessageId && ctx.chat) {
        await ctx.telegram.deleteMessage(ctx.chat.id, state.lastMessageId);
        this.verboseLog(`Deleted previous message ${state.lastMessageId} for user ${userId}`);
      }
    } catch (error: any) {
      // Ignore errors (message might be already deleted or too old)
      // Telegram allows deleting messages only within 48 hours
      if (error?.response?.error_code !== 400 && !error?.response?.description?.includes('message to delete not found')) {
        this.verboseLog(`Could not delete previous message for user ${userId}: ${error?.message || error}`);
      }
    }
  }

  // Helper function to send message and save its ID for future deletion
  private async sendMessageAndSaveId(ctx: Context, message: string, keyboard?: any): Promise<void> {
    const userId = ctx.from?.id;
    
    // Delete previous message if exists
    if (userId) {
      await this.deletePreviousMessage(ctx, userId);
    }
    
    const sentMessage = await ctx.reply(message, keyboard);
    
    // Save message ID for future deletion
    if (userId && sentMessage?.message_id) {
      const state = this.userStates.get(userId) || {};
      state.lastMessageId = sentMessage.message_id;
      this.userStates.set(userId, state);
    }
  }

  // Helper function to send message with optional image
  private async sendMessageWithOptionalImage(
    ctx: Context,
    message: string,
    keyboard: any,
    imagePath?: string
  ): Promise<void> {
    const userId = ctx.from?.id;
    
    // Delete previous message if exists
    if (userId) {
      await this.deletePreviousMessage(ctx, userId);
    }
    
    let sentMessage: any;
    
    if (imagePath?.trim().length > 0) {
      const fullImagePath = path.join('/data', imagePath);
      if (fs.existsSync(fullImagePath)) {
        sentMessage = await ctx.replyWithPhoto({ source: fullImagePath }, { caption: message, ...keyboard });
      } else {
        sentMessage = await ctx.reply(message, keyboard);
      }
    } else {
      sentMessage = await ctx.reply(message, keyboard);
    }
    
    // Save message ID for future deletion
    if (userId && sentMessage?.message_id) {
      const state = this.userStates.get(userId) || {};
      state.lastMessageId = sentMessage.message_id;
      this.userStates.set(userId, state);
    }
  }

  // Helper function to get navigation buttons for one-step sections
  // Excludes the current command to avoid doubling
  private getNavigationButtons(excludeCommand?: string): any[] {
    const buttons = [
      { text: 'Топ 5 займов', command: 'all' },
      { text: 'Все займы', command: 'how' },
      { text: 'Займ недели', command: 'week' },
      { text: 'Займ дня', command: 'day' },
      { text: 'Отмена страховки', command: 'insurance' },
    ];

    // Filter out the excluded command
    const filteredButtons = excludeCommand
      ? buttons.filter(btn => btn.command !== excludeCommand)
      : buttons;

    // Return as inline keyboard buttons
    return filteredButtons.map(btn => [
      Markup.button.callback(btn.text, `nav_${btn.command}`)
    ]);
  }

  // Generic handler for day/week commands (they have identical structure)
  private async handleDayOrWeekCommand(ctx: Context, command: 'day' | 'week'): Promise<void> {
    const user = this.getUserIdentifier(ctx);
    this.verboseLog(`User ${user} executed /${command} command`);
    
    // Track user on command
    await this.trackUserFromContext(ctx);
    
    const data = getTelegramData();
    const offer = data[command];
    // For menu offers: addinfo = user name (first_name), not button name
    const link = this.buildLink(offer.link, ctx);
    this.verboseLog(`User ${user} generated ${command} offer link ${link}`);
    
    // Track offer button click (addinfo = button name)
    try {
      this.trackOfferClick(ctx, offer.buttonNameEn);
    } catch (error) {
      this.logger.error('Error tracking offer click:', error);
    }
    
    const message = this.replacePlaceholders(offer.text, ctx, {
      '%sumuser%': `до ${offer.amount} ₽`
    });
    
    const navigationButtons = this.getNavigationButtons(command);
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url(offer.buttonName, link)],
      ...navigationButtons
    ]);
    
    await this.sendMessageAndSaveId(ctx, `${message}\n\n👉 ${link}`, keyboard);
  }

  // Handler for /day command
  private async handleDayCommand(ctx: Context): Promise<void> {
    await this.handleDayOrWeekCommand(ctx, 'day');
  }

  // Handler for /week command
  private async handleWeekCommand(ctx: Context): Promise<void> {
    await this.handleDayOrWeekCommand(ctx, 'week');
  }

  // Handler for /how command
  private async handleHowCommand(ctx: Context): Promise<void> {
    const user = this.getUserIdentifier(ctx);
    this.verboseLog(`User ${user} executed /how command`);
    
    // Track user on command
    await this.trackUserFromContext(ctx);
    
    const data = getTelegramData();
    const howOffer = data.how;
    // For menu offers: addinfo = user name (first_name), not button name
    const link = this.buildLink(howOffer.link, ctx);
    this.verboseLog(`User ${user} generated how offer link ${link}`);
    
    // Track offer button click (addinfo = button name)
    try {
      this.trackOfferClick(ctx, howOffer.buttonNameEn);
    } catch (error) {
      this.logger.error('Error tracking offer click:', error);
    }
    
    const navigationButtons = this.getNavigationButtons('how');
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url(howOffer.buttonName, link)],
      ...navigationButtons
    ]);
    
    await this.sendMessageAndSaveId(
      ctx,
      `${howOffer.textOne}\n\n👉 ${link}\n\n${howOffer.textSecond}`,
      keyboard
    );
  }

  // Handler for /all command
  private async handleAllCommand(ctx: Context): Promise<void> {
    const user = this.getUserIdentifier(ctx);
    this.verboseLog(`User ${user} executed /all command`);
    
    // Track user on command
    await this.trackUserFromContext(ctx);
    
    const data = getTelegramData();
    const allOffers = data.all;
    
    // Track offer button click (addinfo = button name)
    try {
      this.trackOfferClick(ctx, 'all');
    } catch (error) {
      this.logger.error('Error tracking offer click:', error);
    }
    
    const buttons = allOffers.map((offer) => {
      // For menu offers: addinfo = user name (first_name), not offer name
      const link = this.buildLink(offer.link, ctx);
      return [Markup.button.url(`💚 ${offer.name}`, link)];
    });
    
    let message = `${data.textOneAll}\n\n`;
    allOffers.forEach((offer, index) => {
      message += `${index + 1}. ${offer.name}\n`;
    });
    message += `\n${data.textSecondAll}`;
    
    this.verboseLog(`User ${user} viewing all offers (${allOffers.length} total)`);
    
    const navigationButtons = this.getNavigationButtons('all');
    const keyboard = Markup.inlineKeyboard([
      ...buttons,
      ...navigationButtons
    ]);
    
    await this.sendMessageAndSaveId(ctx, message, keyboard);
  }

  // Handler for /insurance command
  private async handleInsuranceCommand(ctx: Context): Promise<void> {
    const user = this.getUserIdentifier(ctx);
    this.verboseLog(`User ${user} executed /insurance command`);
    
    // Track user on command
    await this.trackUserFromContext(ctx);
    
    const data = getTelegramData();
    const navigationButtons = this.getNavigationButtons('insurance');
    const keyboard = Markup.inlineKeyboard(navigationButtons);
    
    await this.sendMessageAndSaveId(ctx, data.insuranceText, keyboard);
    
    // Send the insurance return PDF document if it exists
    try {
      const pdfPath = path.join(process.cwd(), 'data', 'insurance_return.pdf');
      
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
  }
}

// Telegram bot data structure interface
export interface TelegramBotData {
  startMsg: string;
  startButtonName: string;
  startSeconfMsg: string;
  startThirdfMsg: string;
  startFourthMsg: string;
  startFourthButton: string;
  startAnketa: string;
  startSum: Array<{ button: string; sum: string }>;
  historyCredit: Array<{ name: string; status: string }>;
  day: {
    link: string;
    text: string;
    amount: string;
    startButtonName: string;
  };
  week: {
    link: string;
    text: string;
    amount: string;
    startButtonName: string;
  };
  how: {
    link: string;
    textOne: string;
    textSecond: string;
    startButtonName: string;
  };
  all: Array<{
    name: string;
    link: string;
  }>;
  textOneAll: string;
  textSecondAll: string;
  insuranceText: string;
}

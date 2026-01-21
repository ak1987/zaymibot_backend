// Telegram bot data structure interface
export interface TelegramBotData {
  startMsg: string;
  startMsgImg: string;
  startButtonName: string;
  startButtonNameEn: string;
  secondMsg: string;
  secondMsgImg: string;
  sum: Array<{ buttonName: string; buttonNameEn: string; sum: number }>;
  thirdMsg: string;
  thirdMsgImg: string;
  historyCredit: Array<{ buttonName: string; buttonNameEn: string; status: string }>;
  fourthMsg: string;
  fourthMsgImg: string;
  fourthButton: string;
  fourthButtonEn: string;
  startAnketa: string;
  day: {
    offname: string;
    offnameru: string;
    text: string;
    buttonName: string;
    buttonNameEn: string;
    offcat: string;
    offposition: string;
    link: string;
    amount: string;
  };
  week: {
    offname: string;
    offnameru: string;
    text: string;
    buttonName: string;
    buttonNameEn: string;
    offcat: string;
    offposition: string;
    link: string;
    amount: string;
  };
  how: {
    link: string;
    textOne: string;
    textSecond: string;
    buttonName: string;
    buttonNameEn: string;
  };
  all: Array<{
    name: string;
    link: string;
  }>;
  textOneAll: string;
  textSecondAll: string;
  insuranceText: string;
}

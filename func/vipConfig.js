"use strict";

module.exports = {
  ADMIN_UIDS: ["61595585722894", "61595948481503"], // add your owner UIDs

  // 30B base, longer packs get discount
  PRICING: {
    1: 30e9,
    2: 60e9,
    4: 110e9,   // 10B off
    5: 135e9,   // 15B off
    10: 250e9,  // 50B off
    20: 450e9,  // 150B off
    30: 600e9   // 300B off
  },

  VIP_ONLY: [
    "girl", "girl2", "girl99", "sgirl", "rmtvid", "rmtvid2", "carvid", "anisearch",
    "setnick", "sweetwaifu", "asianwaifu", "crash", "jisoo", "stomp", "papi", "bedi",
    "mia", "hijla", "kick2", "magi", "bedi2", "cowkiss", "gaykiss", "gay2", "kiss",
    "pair7", "pair8", "ummah", "enhance", "cuddle", "animate", "edit1", "anya2",
    "fuck2", "fuckv2", "fuckv", "fuck3", "maze", "dotsvsbot", "dotsvsp2p",
    "ttt", "spy2", "spin", "detective", "marry2", "kill", "hug3"
  ],

  WIN_BOOST: [
    "megaspin", "mine", "redblack", "mwheel", "penalty", "fish", "fishing",
    "adventure", "slot", "slots", "vipslot", "casino", "wheel", "dil", "jisooslot", "spin"
  ],

  QUIZ_BONUS: [
    "quiz", "quiz2", "actor", "cartoon", "animeqz", "flag", "flaggame", "bnquiz", "quiz1"
  ],

  BADGE_CMDS: {
    bal: "check",
    balance: "check",
    daily: "crown",
    rank: "gem",
    topbal: "gem",
    topbalall: "gem"
  },

  WIN_RATE_MULT: 1.12,
  QUIZ_BONUS_AMOUNT: 100_000_000,

  ROASTS: [
    "🚫 আরে ভাই! এই কমান্ড VIP-দের জন্য।\n💎 VIP দাম: $30B থেকে\n🎮 আগে গেম খেলে টাকা আয় কর, তারপর VIP নিস!",
    "😏 গরিব মেম্বার! এই কমান্ড VIP-দের। দাম মাত্র ৩০B — তোর পকেটে কত?",
    "💀 ভাই, VIP ছাড়া এই কমান্ড চলে না। ৩০B দে, নাহলে গেম খেলতে যা।",
    "🥺 ওই গরিব! VIP নিস, তারপর আসিস। এখন zx vip buy 1 চাপ।",
    "🚷 এখানে VIP-দের এন্ট্রি। তুই এখনো সাধারণ মেম্বার। ৩০B জমা কর।"
  ],

  BROKE_ROASTS: [
    "😂 তোর পকেটে টাকা নাই, VIP চাস!\n💸 লাগবে পর্যাপ্ত ব্যালেন্স\n🎮 আগে গেম খেলে টাকা আয় কর!",
    "🥲 VIP-এর দাম তোর ব্যালেন্সের চেয়ে বেশি। গেম খেল, টাকা জমা কর, তারপর আয়।"
  ]
};

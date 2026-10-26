"use strict";

const cfg = require("./vipConfig");

const DAY = 24 * 60 * 60 * 1000;

function formatMoney(n) {
  n = Number(n) || 0;
  if (n >= 1e12) return (n / 1e12).toFixed(2).replace(/\.00$/, "") + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2).replace(/\.00$/, "") + "K";
  return String(Math.floor(n));
}

function formatLeft(ms) {
  if (ms <= 0) return "Expired";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getUserFromMem(uid) {
  try {
    return global.db?.allUserData?.find(u => String(u.userID) === String(uid)) || null;
  } catch {
    return null;
  }
}

function getExpireFromData(userData) {
  if (!userData) return 0;
  const data = userData.data || {};
  if (data.vip && typeof data.vip === "object" && data.vip.expires)
    return Number(data.vip.expires) || 0;
  return Number(data.vipExpireTime || 0) || 0;
}

function isAdmin(uid) {
  return cfg.ADMIN_UIDS.map(String).includes(String(uid));
}

function isVipOnlyCommand(name) {
  return cfg.VIP_ONLY.map(s => s.toLowerCase()).includes(String(name || "").toLowerCase());
}

function isWinBoostGame(name) {
  return cfg.WIN_BOOST.map(s => s.toLowerCase()).includes(String(name || "").toLowerCase());
}

function isQuizBonusCmd(name) {
  return cfg.QUIZ_BONUS.map(s => s.toLowerCase()).includes(String(name || "").toLowerCase());
}

async function getUser(usersData, uid) {
  if (usersData && typeof usersData.get === "function") {
    try {
      return await usersData.get(String(uid));
    } catch (_) {}
  }
  return getUserFromMem(uid);
}

function syncMem(uid, vipObj) {
  try {
    const idx = global.db.allUserData.findIndex(u => String(u.userID) === String(uid));
    if (idx === -1) return;
    global.db.allUserData[idx].data = global.db.allUserData[idx].data || {};
    global.db.allUserData[idx].data.vip = vipObj;
  } catch (_) {}
}

/**
 * Returns true if VIP active. If expired, clears DB and optionally notifies thread.
 */
async function isVipActive(uid, usersData, api) {
  const user = await getUser(usersData, uid);
  const exp = getExpireFromData(user);
  if (!exp) return false;
  if (exp > Date.now()) return true;

  // expired — clear + roast once
  const data = { ...(user?.data || {}) };
  const lastThread = data.vip?.notifyThread || null;
  data.vip = null;
  if (usersData) {
    try {
      await usersData.set(String(uid), { data });
    } catch (_) {}
  }
  syncMem(uid, null);

  if (api && lastThread) {
    try {
      const name = user?.name || uid;
      api.sendMessage(
        `⏰ ${name} এর VIP শেষ!\n💀 এখন থেকে সাধারণ মেম্বার।\n🛒 আবার কিনতে: zx vip buy`,
        lastThread
      );
    } catch (_) {}
  }
  return false;
}

async function getVipInfo(uid, usersData) {
  const user = await getUser(usersData, uid);
  const exp = getExpireFromData(user);
  const active = exp > Date.now();
  return {
    active,
    expires: exp,
    left: active ? formatLeft(exp - Date.now()) : "—",
    until: active
      ? new Date(exp).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })
      : "—",
    name: user?.name || String(uid)
  };
}

async function addVip(uid, days, usersData, threadID) {
  days = Number(days) || 0;
  if (days <= 0) throw new Error("Invalid days");
  const user = await getUser(usersData, uid);
  const data = { ...(user?.data || {}) };
  const cur = getExpireFromData(user);
  const base = Math.max(cur, Date.now());
  const expires = base + days * DAY;
  data.vip = {
    expires,
    notifyThread: threadID ? String(threadID) : (data.vip?.notifyThread || null)
  };
  await usersData.set(String(uid), { data });
  syncMem(uid, data.vip);
  return expires;
}

async function removeVipDays(uid, days, usersData) {
  days = Number(days) || 0;
  const user = await getUser(usersData, uid);
  const cur = getExpireFromData(user);
  if (cur <= Date.now()) {
    await clearVip(uid, usersData);
    return 0;
  }
  const next = cur - days * DAY;
  if (next <= Date.now()) {
    await clearVip(uid, usersData);
    return 0;
  }
  const data = { ...(user.data || {}) };
  data.vip = { ...(data.vip || {}), expires: next };
  await usersData.set(String(uid), { data });
  syncMem(uid, data.vip);
  return next;
}

async function clearVip(uid, usersData) {
  const user = await getUser(usersData, uid);
  const data = { ...(user?.data || {}) };
  data.vip = null;
  await usersData.set(String(uid), { data });
  syncMem(uid, null);
  return true;
}

async function getVipBoost(uid, type, usersData) {
  const active = await isVipActive(uid, usersData);
  if (!active) {
    if (type === "gambling") return 1;
    if (type === "quiz") return 0;
    return 0;
  }
  if (type === "gambling") return cfg.WIN_RATE_MULT;
  if (type === "quiz") return cfg.QUIZ_BONUS_AMOUNT;
  return 0;
}

function getBadge(uid, cmdName, usersDataSync) {
  // sync helper for display — pass userData if known
  return null; // use getBadgeAsync
}

async function getBadgeAsync(uid, cmdName, usersData) {
  const active = await isVipActive(uid, usersData);
  if (!active) return "";
  const style = cfg.BADGE_CMDS[String(cmdName || "").toLowerCase()] || "crown";
  if (style === "check") return "✓ VIP";
  if (style === "gem") return "[💎]";
  return "👑";
}

/**
 * Sync badge for display when userData already loaded.
 * Accepts userData object OR uid string (uid alone cannot verify VIP without DB — returns "").
 */
function vipBadge(userDataOrUid, cmdName) {
  try {
    if (userDataOrUid && typeof userDataOrUid === "object") {
      const exp = getExpireFromData(userDataOrUid);
      if (!exp || exp <= Date.now()) return "";
      const style = cfg.BADGE_CMDS[String(cmdName || "").toLowerCase()] || "crown";
      if (style === "check") return " ✓ VIP";
      if (style === "gem") return " [💎]";
      return " 👑";
    }
  } catch (_) {}
  return "";
}

function vipDeniedMessage(balance) {
  const list = cfg.ROASTS;
  const msg = list[Math.floor(Math.random() * list.length)];
  const bal = formatMoney(balance || 0);
  return `${msg}\n💰 তোর balance: $${bal}`;
}

function brokeMessage(balance, need) {
  const list = cfg.BROKE_ROASTS;
  const msg = list[Math.floor(Math.random() * list.length)];
  return `${msg}\n💸 Balance: $${formatMoney(balance)} | লাগবে: $${formatMoney(need)}`;
}

function getPrice(days) {
  const d = Number(days);
  if (cfg.PRICING[d] != null) return cfg.PRICING[d];
  return d * 30e9;
}

function getActiveList() {
  const now = Date.now();
  const list = [];
  for (const u of global.db?.allUserData || []) {
    const exp = getExpireFromData(u);
    if (exp > now) {
      list.push({
        userID: u.userID,
        name: u.name || "Unknown",
        expires: exp,
        left: formatLeft(exp - now)
      });
    }
  }
  list.sort((a, b) => b.expires - a.expires);
  return list;
}


async function getBankBalance(uid) {
  try {
    const mongoose = require("mongoose");
    if (!mongoose.connection || mongoose.connection.readyState !== 1) return 0;
    let BankUser = mongoose.models.DiabloBankUser;
    if (!BankUser) {
      const schema = new mongoose.Schema({
        userID: { type: String, required: true, unique: true },
        bankBalance: { type: Number, default: 0 }
      });
      BankUser = mongoose.model("DiabloBankUser", schema);
    }
    const doc = await BankUser.findOne({ userID: String(uid) }).lean();
    return Number(doc?.bankBalance || 0);
  } catch (_) {
    return 0;
  }
}

async function getTotalBalance(uid, usersData) {
  let wallet = 0;
  try {
    const u = await getUser(usersData, uid);
    wallet = Number(u?.money || 0);
  } catch (_) {}
  const bank = await getBankBalance(uid);
  return { wallet, bank, total: wallet + bank };
}

/** Deduct amount: wallet first, then bank */
async function deductMoney(uid, amount, usersData) {
  amount = Number(amount) || 0;
  const { wallet, bank, total } = await getTotalBalance(uid, usersData);
  if (total < amount) return { ok: false, wallet, bank, total };

  let left = amount;
  let newWallet = wallet;
  let newBank = bank;

  if (newWallet >= left) {
    newWallet -= left;
    left = 0;
  } else {
    left -= newWallet;
    newWallet = 0;
    newBank -= left;
    left = 0;
  }

  await usersData.set(String(uid), { money: newWallet });
  try {
    const mongoose = require("mongoose");
    const BankUser = mongoose.models.DiabloBankUser;
    if (BankUser) {
      await BankUser.findOneAndUpdate(
        { userID: String(uid) },
        { $set: { bankBalance: Math.max(0, newBank) } },
        { upsert: true }
      );
    }
  } catch (e) {
    console.error("[VIP deduct bank]", e.message);
  }
  return { ok: true, wallet: newWallet, bank: newBank, total: newWallet + newBank };
}

module.exports = {
  cfg,
  formatMoney,
  formatLeft,
  isAdmin,
  isVipOnlyCommand,
  isWinBoostGame,
  isQuizBonusCmd,
  isVipActive,
  getVipInfo,
  addVip,
  removeVipDays,
  clearVip,
  getVipBoost,
  getBadgeAsync,
  vipBadge,
  getBadge,
  vipDeniedMessage,
  brokeMessage,
  getPrice,
  getActiveList,
  getExpireFromData,
  getTotalBalance,
  getBankBalance,
  deductMoney
};

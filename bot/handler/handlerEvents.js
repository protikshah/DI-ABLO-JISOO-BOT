const fs = require("fs-extra");
const SpamTracker = require("../../func/spamTracker.js");
const vipManager = require("../../func/vipManager.js");
const CooldownManager = require("../../func/cooldownManager.js");
const analyticsBatcher = require("../../func/analyticsBatcher.js");
const nullAndUndefined = [undefined, null];

// Dual-level spam tracker: per-user + per-group
const spamTracker = new SpamTracker({
  userThreshold: 6,              // >5 commands
  userTimeWindow: 15000,         // 15 seconds
  userBanDuration: 10 * 60 * 1000, // 10 minutes
  threadThreshold: 11,           // >10 commands
  threadTimeWindow: 15000,       // 15 seconds
  threadBanDuration: 5 * 60 * 1000, // 5 minutes
  maxEntries: 2000,
  cleanupInterval: 30000
});

// CooldownManager is already a singleton instance
const cooldownManager = require("../../func/cooldownManager.js");

function getType(obj) {
  return Object.prototype.toString.call(obj).slice(8, -1);
}

// ✅ cmdswitch: এই গ্রুপে কমান্ড বন্ধ কিনা
//   "video"  → শুধু video বন্ধ
//   "*"      → allcmds: সব কমান্ড বন্ধ (protected আর "+name" exception বাদে)
const PROTECTED_CMDS = ["cmdswitch", "gcswitch"];

function isCmdDisabled(threadID, commandName) {
  const m = global.__disabledCmds;
  if (!m) return false;
  const set = m.get(String(threadID));
  if (!set) return false;
  if (set.has("*"))
    return !(PROTECTED_CMDS.includes(commandName) || set.has("+" + commandName));
  return set.has(commandName);
}

async function checkSpamBanned(threadID, senderID, globalData) {
  const tid = String(threadID);
  const uid = String(senderID);

  // Memory checks first (fast)
  if (spamTracker.isUserBanned(uid)) return { type: "user" };
  if (spamTracker.isThreadBanned(tid)) return { type: "thread" };

  // DB fallback — users
  try {
    const spamBannedUsers = await globalData.get("spamBannedUsers", "data", {});
    if (spamBannedUsers[uid]) {
      if (spamBannedUsers[uid].expireTime > Date.now()) {
        spamTracker.banUser(uid, spamBannedUsers[uid].reason, spamBannedUsers[uid].expireTime - Date.now());
        return { type: "user" };
      } else {
        delete spamBannedUsers[uid];
        await globalData.set("spamBannedUsers", spamBannedUsers, "data");
      }
    }
  } catch (_) {}

  // DB fallback — threads
  try {
    const spamBannedThreads = await globalData.get("spamBannedThreads", "data", {});
    if (spamBannedThreads[tid]) {
      if (spamBannedThreads[tid].expireTime > Date.now()) {
        spamTracker.banThread(tid, spamBannedThreads[tid].reason, spamBannedThreads[tid].expireTime - Date.now());
        return { type: "thread" };
      } else {
        delete spamBannedThreads[tid];
        await globalData.set("spamBannedThreads", spamBannedThreads, "data");
      }
    }
  } catch (_) {}

  return null;
}

// keep old name as alias for safety
async function checkSpamBannedThread(threadID, globalData) {
  const r = await checkSpamBanned(threadID, "0", globalData);
  return !!(r && r.type === "thread");
}

function applySpamConfig() {
  const config = global.GoatBot?.config || {};
  const sc = config.spamProtection || {};

  // User: >5 cmds in 15s → 10 min ban
  spamTracker.options.userThreshold = sc.userThreshold ?? 6;
  spamTracker.options.userTimeWindow = (sc.userTimeWindow ?? 15) * 1000;
  spamTracker.options.userBanDuration = (sc.userBanDuration ?? 10) * 60 * 1000;

  // Group: >10 cmds in 15s → 5 min ban
  spamTracker.options.threadThreshold = sc.threadThreshold ?? 11;
  spamTracker.options.threadTimeWindow = (sc.threadTimeWindow ?? 15) * 1000;
  spamTracker.options.threadBanDuration = (sc.threadBanDuration ?? 5) * 60 * 1000;
}

async function trackCommandSpam(threadID, senderID, threadName, globalData, message, commandName) {
  applySpamConfig();

  const tid = String(threadID);
  const uid = String(senderID);
  const cmd = commandName || message.body?.split(" ")[0] || "unknown";

  const result = spamTracker.trackCommand(tid, uid, cmd);
  const now = Date.now();
  let blocked = false;

  // —— User ban ——
  if (result.shouldBanUser) {
    const banMs = spamTracker.options.userBanDuration;
    try {
      const spamBannedUsers = await globalData.get("spamBannedUsers", "data", {});
      spamBannedUsers[uid] = {
        bannedAt: now,
        expireTime: now + banMs,
        reason: "Too many commands in a short time"
      };
      await globalData.set("spamBannedUsers", spamBannedUsers, "data");
    } catch (_) {}

    const mins = Math.round(banMs / 60000);
    try {
      message.reply(`⛔ | You are temporarily restricted for ${mins} minutes due to rapid command usage.\nPlease wait and try again later.`);
    } catch (_) {}
    global.utils.log.warn("SPAM_USER_BAN", `User ${uid} banned ${mins}m for command spam`);
    blocked = true;
  }

  // —— Group ban ——
  if (result.shouldBanThread) {
    const banMs = spamTracker.options.threadBanDuration;
    try {
      const spamBannedThreads = await globalData.get("spamBannedThreads", "data", {});
      spamBannedThreads[tid] = {
        bannedAt: now,
        expireTime: now + banMs,
        threadName: threadName || "Unknown",
        reason: "Group command flood detected"
      };
      await globalData.set("spamBannedThreads", spamBannedThreads, "data");
    } catch (_) {}

    const mins = Math.round(banMs / 60000);
    try {
      message.reply(`⛔ | This group is temporarily restricted for ${mins} minutes due to command flood.\nPlease wait a bit and try again.`);
    } catch (_) {}
    global.utils.log.warn("SPAM_THREAD_BAN", `Thread ${tid} (${threadName}) banned ${mins}m for command spam`);
    blocked = true;
  }

  return blocked;
}

function getRole(threadData, senderID) {
  const config = global.GoatBot.config;
  const adminBot = config.adminBot || [];
  const devUsers = config.devUsers || [];
  const premiumUsers = config.premiumUsers || [];
  if (!senderID)
    return 0;
  const adminBox = threadData ? threadData.adminIDs || [] : [];

  // Priority: Developer (4) > Bot Admin (2) > Premium (3) > Group Admin (1) > Normal (0)
  // Admin and Dev always get their role regardless of premium membership
  if (devUsers.includes(senderID.toString()))
    return 4;
  if (adminBot.includes(senderID.toString()))
    return 2;
  if (premiumUsers.includes(senderID.toString())) {
    const userData = global.db.allUserData.find(u => u.userID == senderID);
    if (userData && userData.data && userData.data.premiumExpireTime) {
      if (userData.data.premiumExpireTime < Date.now()) {
        global.temp.expiredPremiumUsers = global.temp.expiredPremiumUsers || [];
        if (!global.temp.expiredPremiumUsers.includes(senderID))
          global.temp.expiredPremiumUsers.push(senderID);
        return adminBox.map(String).includes(senderID.toString()) ? 1 : 0;
      }
    }
    return 3;
  }
  if (adminBox.map(String).includes(senderID.toString()))
    return 1;
  return 0;
}

// Role permission matrix:
//   Role 0 - Normal user     : can use commands with needRole === 0
//   Role 1 - Group Admin     : can use commands with needRole <= 1
//   Role 2 - Bot Admin       : can use ALL commands (highest rank)
//   Role 3 - Premium         : can use commands with needRole === 0 OR needRole === 3 ONLY
//   Role 4 - Bot Developer   : can use ALL commands (highest rank)
function canUseCommand(userRole, needRole) {
  if (userRole === 4 || userRole === 2)
    return true;
  if (userRole === 3)
    return needRole === 0 || needRole === 3;
  return needRole <= userRole;
}

async function checkMoneyRequirement(userData, requiredMoney) {
  if (!requiredMoney || requiredMoney <= 0)
    return true;
  const userMoney = userData.money || 0;
  return userMoney >= requiredMoney;
}

function getText(type, reason, time, targetID, lang) {
  const utils = global.utils;
  if (type == "userBanned")
    return utils.getText({ lang, head: "handlerEvents" }, "userBanned", reason, time, targetID);
  else if (type == "threadBanned")
    return utils.getText({ lang, head: "handlerEvents" }, "threadBanned", reason, time, targetID);
  else if (type == "onlyAdminBox")
    return utils.getText({ lang, head: "handlerEvents" }, "onlyAdminBox");
  else if (type == "onlyAdminBot")
    return utils.getText({ lang, head: "handlerEvents" }, "onlyAdminBot");
}

function replaceShortcutInLang(text, prefix, commandName) {
  return text
    .replace(/\{(?:p|prefix)\}/g, prefix)
    .replace(/\{(?:n|name)\}/g, commandName)
    .replace(/\{pn\}/g, `${prefix}${commandName}`);
}

function getRoleConfig(utils, command, isGroup, threadData, commandName) {
  let roleConfig;
  if (utils.isNumber(command.config.role)) {
    roleConfig = {
      onStart: command.config.role
    };
  }
  else if (typeof command.config.role == "object" && !Array.isArray(command.config.role)) {
    if (!command.config.role.onStart)
      command.config.role.onStart = 0;
    roleConfig = command.config.role;
  }
  else {
    roleConfig = {
      onStart: 0
    };
  }

  if (isGroup)
    roleConfig.onStart = threadData.data.setRole?.[commandName] ?? roleConfig.onStart;

  for (const key of ["onChat", "onStart", "onReaction", "onReply"]) {
    if (roleConfig[key] == undefined)
      roleConfig[key] = roleConfig.onStart;
  }

  return roleConfig;
}

function isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, lang) {
  const config = global.GoatBot.config;
  const { adminBot, hideNotiMessage } = config;

  // check if user banned
  const infoBannedUser = userData.banned;
  if (infoBannedUser.status == true) {
    const { reason, date } = infoBannedUser;
    if (hideNotiMessage.userBanned == false)
      message.reply(getText("userBanned", reason, date, senderID, lang));
    return true;
  }

  // check if only admin bot
  if (
    config.adminOnly.enable == true
    && !adminBot.includes(senderID)
    && !config.adminOnly.ignoreCommand.includes(commandName)
  ) {
    if (hideNotiMessage.adminOnly == false)
      message.reply(getText("onlyAdminBot", null, null, null, lang));
    return true;
  }

  // ==========    Check Thread    ========== //
  if (isGroup == true) {
    if (
      threadData.data.onlyAdminBox === true
      && !threadData.adminIDs.includes(senderID)
      && !(threadData.data.ignoreCommanToOnlyAdminBox || []).includes(commandName)
    ) {
      // check if only admin box
      if (!threadData.data.hideNotiMessageOnlyAdminBox)
        message.reply(getText("onlyAdminBox", null, null, null, lang));
      return true;
    }

    // check if thread banned
    const infoBannedThread = threadData.banned;
    if (infoBannedThread.status == true) {
      const { reason, date } = infoBannedThread;
      if (hideNotiMessage.threadBanned == false)
        message.reply(getText("threadBanned", reason, date, threadID, lang));
      return true;
    }
  }
  return false;
}


function createGetText2(langCode, pathCustomLang, prefix, command) {
  const commandType = command.config.countDown ? "command" : "command event";
  const commandName = command.config.name;
  let customLang = {};
  let getText2 = () => { };
  if (fs.existsSync(pathCustomLang))
    customLang = require(pathCustomLang)[commandName]?.text || {};
  if (command.langs || customLang || {}) {
    getText2 = function (key, ...args) {
      let lang = command.langs?.[langCode]?.[key] || customLang[key] || "";
      lang = replaceShortcutInLang(lang, prefix, commandName);
      for (let i = args.length - 1; i >= 0; i--)
        lang = lang.replace(new RegExp(`%${i + 1}`, "g"), args[i]);
      return lang || `❌ Can't find text on language "${langCode}" for ${commandType} "${commandName}" with key "${key}"`;
    };
  }
  return getText2;
}

module.exports = function (api, threadModel, userModel, dashBoardModel, globalModel, usersData, threadsData, dashBoardData, globalData) {
  return async function (event, message) {

    const { utils, client, GoatBot } = global;
    const { getPrefix, removeHomeDir, log, getTime } = utils;
    const { config, configCommands: { envGlobal, envCommands, envEvents } } = GoatBot;
    const { autoRefreshThreadInfoFirstTime } = config.database;
    let { hideNotiMessage = {} } = config;

    const { body, messageID, threadID, isGroup } = event;

    // Check if has threadID
    if (!threadID)
      return;

    const senderID = event.userID || event.senderID || event.author;

    let threadData = global.db.allThreadData.find(t => t.threadID == threadID);
    let userData = global.db.allUserData.find(u => u.userID == senderID);

    if (!userData && !isNaN(senderID))
      userData = await usersData.create(senderID);

    if (!threadData && !isNaN(threadID)) {
      if (global.temp.createThreadDataError.has(threadID))
        return;
      threadData = await threadsData.create(threadID);
      global.db.receivedTheFirstMessage[threadID] = true;
    }
    else {
      if (
        autoRefreshThreadInfoFirstTime === true
        && !global.db.receivedTheFirstMessage[threadID]
      ) {
        global.db.receivedTheFirstMessage[threadID] = true;
        await threadsData.refreshInfo(threadID);
      }
    }

    const threadSettings = threadData?.settings || {};
    if (typeof threadSettings.hideNotiMessage == "object")
      hideNotiMessage = threadSettings.hideNotiMessage;

    const prefix = getPrefix(threadID);
    const role = getRole(threadData, senderID);

    // ✅ MUTED THREAD CHECK (gcswitch / jisooon / jisoooff)
    const isMuted = !!(global.__mutedThreads && global.__mutedThreads.has(String(threadID)));

    const parameters = {
      api, usersData, threadsData, message, event,
      userModel, threadModel, prefix, dashBoardModel,
      globalModel, dashBoardData, globalData, envCommands,
      envEvents, envGlobal, role,
      removeCommandNameFromBody: function removeCommandNameFromBody(body_, prefix_, commandName_) {
        if ([body_, prefix_, commandName_].every(x => nullAndUndefined.includes(x)))
          throw new Error("Please provide body, prefix and commandName to use this function, this function without parameters only support for onStart");
        for (let i = 0; i < arguments.length; i++)
          if (typeof arguments[i] != "string")
            throw new Error(`The parameter "${i + 1}" must be a string, but got "${getType(arguments[i])}"`);

        return body_.replace(new RegExp(`^${prefix_}(\\s+|)${commandName_}`, "i"), "").trim();
      }
    };
    const langCode = threadData.data.lang || config.language || "en";

    function createMessageSyntaxError(commandName) {
      message.SyntaxError = async function () {
        return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "commandSyntaxError", prefix, commandName));
      };
    }

    /*
      +-----------------------------------------------+
      |               WHEN CALL COMMAND               |
      +-----------------------------------------------+
    */
    let isUserCallCommand = false;
    async function onStart() {
      // —————————————— CHECK USE BOT —————————————— //
      if (!body)
        return;

      // ✅ MUTED THREAD: only gcswitch (jisooon / jisoooff) is allowed
      if (isMuted) {
        const raw = body.startsWith(prefix) ? body.slice(prefix.length) : body;
        const firstWord = raw.trim().split(/ +/)[0].toLowerCase();
        const mutedCmd = GoatBot.commands.get(firstWord) || GoatBot.commands.get(GoatBot.aliases.get(firstWord));
        if (!mutedCmd || mutedCmd.config.name !== "gcswitch")
          return;
      }

      const noPrefixEnabled = config.noPrefix === true;
      const userCanSkipPrefix = role === 2 || role === 4;
      const hasPrefix = body.startsWith(prefix);
      const hasNoPrefix = noPrefixEnabled && userCanSkipPrefix && !hasPrefix;

      if (!hasPrefix && !hasNoPrefix)
        return;

      // —————————— CHECK SPAM BAN (user + group) —————————— //
      {
        const spamHit = await checkSpamBanned(threadID, senderID, globalData);
        if (spamHit) {
          if (spamHit.type === "user") {
            const info = spamTracker.getUserBanInfo(senderID);
            const mins = info ? Math.max(1, Math.ceil(info.remainingTime / 60000)) : 10;
            if (!hideNotiMessage.threadBanned)
              message.reply(`⛔ | You are temporarily restricted for ${mins} more minute(s) due to rapid command usage.\nPlease wait and try again later.`);
          } else {
            const info = spamTracker.getBanInfo(threadID);
            const mins = info ? Math.max(1, Math.ceil(info.remainingTime / 60000)) : 5;
            if (!hideNotiMessage.threadBanned)
              message.reply(`⛔ | This group is temporarily restricted for ${mins} more minute(s) due to command flood.\nPlease wait a bit and try again.`);
          }
          return;
        }
      }
      const dateNow = Date.now();
      const args = hasPrefix
        ? body.slice(prefix.length).trim().split(/ +/)
        : body.trim().split(/ +/);
      // ————————————  CHECK HAS COMMAND ——————————— //
      let commandName = args.shift().toLowerCase();
      let command = GoatBot.commands.get(commandName) || GoatBot.commands.get(GoatBot.aliases.get(commandName));
      // ———————— CHECK ALIASES SET BY GROUP ———————— //
      const aliasesData = threadData.data.aliases || {};
      for (const cmdName in aliasesData) {
        if (aliasesData[cmdName].includes(commandName)) {
          command = GoatBot.commands.get(cmdName);
          break;
        }
      }
      // ————————————— SET COMMAND NAME ————————————— //
      if (command)
        commandName = command.config.name;

      // ✅ CMDSWITCH: এই গ্রুপে কমান্ড বন্ধ থাকলে চুপচাপ ফিরে যাবে
      if (command && isCmdDisabled(threadID, commandName))
        return;

      // ——————— FUNCTION REMOVE COMMAND NAME ———————— //
      function removeCommandNameFromBody(body_, prefix_, commandName_) {
        if (arguments.length) {
          if (typeof body_ != "string")
            throw new Error(`The first argument (body) must be a string, but got "${getType(body_)}"`);
          if (typeof prefix_ != "string")
            throw new Error(`The second argument (prefix) must be a string, but got "${getType(prefix_)}"`);
          if (typeof commandName_ != "string")
            throw new Error(`The third argument (commandName) must be a string, but got "${getType(commandName_)}"`);

          return body_.replace(new RegExp(`^${prefix_}(\\s+|)${commandName_}`, "i"), "").trim();
        }
        else {
          return body.replace(new RegExp(`^${prefix}(\\s+|)${commandName}`, "i"), "").trim();
        }
      }
      // —————  CHECK BANNED OR ONLY ADMIN BOX  ————— //
      if (isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, langCode))
        return;
      if (!command) {
        // In noPrefix mode, only respond if the user explicitly used the prefix.
        // If the message had no prefix, silently ignore unrecognized words.
        if (!hasPrefix)
          return;
        if (!hideNotiMessage.commandNotFound) {
          if (!commandName) {
            return await message.reply(`That's only the prefix. Type ${prefix}help to see commands.`);
          }

          // Optimized command suggestion with caching and quick checks
          function getCachedCommandNames() {
            const cmdCount = GoatBot.commands.size;
            const aliasCount = GoatBot.aliases.size;
            const cache = GoatBot._cmdNameCache || {};
            if (!cache.list || cache.cmdCount !== cmdCount || cache.aliasCount !== aliasCount) {
              const list = [...GoatBot.commands.keys(), ...GoatBot.aliases.keys()];
              GoatBot._cmdNameCache = {
                list,
                lower: list.map(s => s.toLowerCase()),
                cmdCount,
                aliasCount
              };
            }
            return GoatBot._cmdNameCache;
          }

          const { list, lower } = getCachedCommandNames();
          const input = commandName.toLowerCase();

          // 1) prefix startsWith suggestion
          let index = lower.findIndex(n => n.startsWith(input));
          let bestMatch = index !== -1 ? list[index] : null;

          // 2) fallback: constrained edit distance on nearby lengths only
          if (!bestMatch) {
            function editDistance(a, b) {
              const m = a.length, n = b.length;
              if (Math.abs(m - n) > 2) return 99;
              const dp = Array.from({ length: m + 1 }, (_, i) => i);
              for (let j = 1; j <= n; j++) {
                let prev = j - 1;
                let cur = j;
                for (let i = 1; i <= m; i++) {
                  const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                  const tmp = Math.min(
                    dp[i] + 1,        // deletion
                    cur + 1,          // insertion
                    dp[i - 1] + cost  // substitution
                  );
                  dp[i - 1] = prev;
                  prev = tmp;
                  cur = tmp;
                }
                dp[m] = cur;
              }
              return dp[m];
            }
            let best = { name: null, dist: 3 };
            for (let i = 0; i < lower.length; i++) {
              const name = lower[i];
              if (Math.abs(name.length - input.length) > 2) continue;
              const d = editDistance(input, name);
              if (d < best.dist) {
                best = { name: list[i], dist: d };
                if (d === 0) break;
              }
            }
            if (best.dist <= 2) bestMatch = best.name;
          }

          let suggestionMsg = utils.getText({ lang: langCode, head: "handlerEvents" }, "commandNotFound", commandName, prefix);
          if (bestMatch) {
            suggestionMsg += ` Try: ${prefix}${bestMatch}`;
          }

          return await message.reply(suggestionMsg);
        }
        else
          return true;
      }
      // ————————— VIP COMMAND GATE ————————— //
      try {
        const vipCmdName = String(command?.config?.name || commandName || "").toLowerCase();
        if (vipManager.isVipOnlyCommand(vipCmdName)) {
          const vipOk = await vipManager.isVipActive(senderID, usersData, api);
          if (!vipOk && !vipManager.isAdmin(senderID)) {
            let bal = (userData && userData.money) || 0;
            try {
              const t = await vipManager.getTotalBalance(senderID, usersData);
              bal = t.total || bal;
            } catch (_) {}
            return await message.reply(vipManager.vipDeniedMessage(bal));
          }
        }
      } catch (e) {
        console.error("[VIP GATE]", e.message || e);
      }

      // ————————— CHECK MONEY REQUIREMENT (FIRST) ————————— //
      const requiredMoney = command.config.requiredMoney;
      if (requiredMoney && requiredMoney > 0) {
        const hasEnoughMoney = await checkMoneyRequirement(userData, requiredMoney);
        if (!hasEnoughMoney) {
          const userMoney = userData.money || 0;
          return await message.reply(
            `You need at least $${requiredMoney} to use this command.\n` +
            `Your balance: $${userMoney}\n` +
            `Missing: $${requiredMoney - userMoney}`
          );
        }
      }

      // ————————————— CHECK PERMISSION ———————————— //
      const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
      const needRole = roleConfig.onStart;

      if (!canUseCommand(role, needRole)) {
        if (!hideNotiMessage.needRoleToUseCmd) {
          if (needRole == 1)
            return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdmin", commandName));
          else if (needRole == 2)
            return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdminBot2", commandName));
          else if (needRole == 3)
            return await message.reply("This command requires premium access. Please upgrade to continue.");
          else if (needRole == 4)
            return await message.reply("This feature is restricted to the bot developers.");
          else
            return await message.reply("You do not have permission to use this command.");
        }
        else {
          return true;
        }
      }
      // ———————————————— OPTIMIZED COOLDOWN ———————————————— //
      let getCoolDown = command.config.countDown;
      if ((!getCoolDown && getCoolDown !== 0) || isNaN(getCoolDown))
        getCoolDown = 1;
      const cooldownMs = getCoolDown * 1000;

      const cooldownCheck = cooldownManager.checkCooldown(commandName, senderID, cooldownMs);
      if (cooldownCheck.onCooldown) {
        return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "waitingForCommand", cooldownCheck.remainingTime.toString()));
      }

      // ——————————————— RUN COMMAND ——————————————— //
      const time = getTime("DD/MM/YYYY HH:mm:ss");
      isUserCallCommand = true;

      // —————————— TRACK SPAM AND AUTO-BAN (user + group) —————————— //
      {
        const threadName = threadData?.threadName || "Unknown Group";
        const wasSpamBanned = await trackCommandSpam(threadID, senderID, threadName, globalData, message, commandName);
        if (wasSpamBanned) {
          return;
        }
      }

      try {
        // analytics command call - batched for performance
        analyticsBatcher.record(commandName);

        createMessageSyntaxError(commandName);
        const getText2 = createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command);
        await command.onStart({
          ...parameters,
          args,
          commandName,
          getLang: getText2,
          removeCommandNameFromBody
        });

        // Set cooldown after successful execution
        cooldownManager.setCooldown(commandName, senderID);

        // Deduct money if requiredMoney was set
        if (requiredMoney && requiredMoney > 0) {
          try {
            await usersData.subtractMoney(senderID, requiredMoney);
          } catch (err) {
            log.err("MONEY", `Failed to deduct $${requiredMoney} from ${senderID}`, err);
          }
        }

        log.info("CALL COMMAND", `${commandName} | ${userData.name} | ${senderID} | ${threadID} | ${args.join(" ")}`);
      }
      catch (err) {
        log.err("CALL COMMAND", `An error occurred when calling the command ${commandName}`, err);
        return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred", time, commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
      }
    }


    /*
     +------------------------------------------------+
     |                    ON CHAT                     |
     +------------------------------------------------+
    */
    async function onChat() {
      if (isMuted) return;
      const allOnChat = GoatBot.onChat || [];
      const args = body ? body.split(/ +/) : [];
      for (const key of allOnChat) {
        const command = GoatBot.commands.get(key);
        if (!command)
          continue;
        const commandName = command.config.name;
        if (isCmdDisabled(threadID, commandName)) continue;

        // —————————————— CHECK PERMISSION —————————————— //
        const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
        const needRole = roleConfig.onChat;
        if (!canUseCommand(role, needRole))
          continue;

        const getText2 = createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command);
        const time = getTime("DD/MM/YYYY HH:mm:ss");
        createMessageSyntaxError(commandName);

        if (getType(command.onChat) == "Function") {
          const defaultOnChat = command.onChat;
          // convert to AsyncFunction
          command.onChat = async function () {
            return defaultOnChat(...arguments);
          };
        }

        command.onChat({
          ...parameters,
          isUserCallCommand,
          args,
          commandName,
          getLang: getText2
        })
          .then(async (handler) => {
            if (typeof handler == "function") {
              if (isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, langCode))
                return;
              try {
                await handler();
                log.info("onChat", `${commandName} | ${userData.name} | ${senderID} | ${threadID} | ${args.join(" ")}`);
              }
              catch (err) {
                await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred2", time, commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
              }
            }
          })
          .catch(err => {
            log.err("onChat", `An error occurred when calling the command onChat ${commandName}`, err);
          });
      }
    }


    /*
     +------------------------------------------------+
     |                   ON ANY EVENT                 |
     +------------------------------------------------+
    */
    async function onAnyEvent() {
      if (isMuted) return;
      const allOnAnyEvent = GoatBot.onAnyEvent || [];
      let args = [];
      if (typeof event.body == "string" && event.body.startsWith(prefix))
        args = event.body.split(/ +/);

      for (const key of allOnAnyEvent) {
        if (typeof key !== "string")
          continue;
        const command = GoatBot.commands.get(key);
        if (!command)
          continue;
        const commandName = command.config.name;
        if (isCmdDisabled(threadID, commandName)) continue;
        const time = getTime("DD/MM/YYYY HH:mm:ss");
        createMessageSyntaxError(commandName);

        const getText2 = createGetText2(langCode, `${process.cwd()}/languages/events/${langCode}.js`, prefix, command);

        if (getType(command.onAnyEvent) == "Function") {
          const defaultOnAnyEvent = command.onAnyEvent;
          // convert to AsyncFunction
          command.onAnyEvent = async function () {
            return defaultOnAnyEvent(...arguments);
          };
        }

        command.onAnyEvent({
          ...parameters,
          args,
          commandName,
          getLang: getText2
        })
          .then(async (handler) => {
            if (typeof handler == "function") {
              try {
                await handler();
                log.info("onAnyEvent", `${commandName} | ${senderID} | ${userData.name} | ${threadID}`);
              }
              catch (err) {
                message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred7", time, commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
                log.err("onAnyEvent", `An error occurred when calling the command onAnyEvent ${commandName}`, err);
              }
            }
          })
          .catch(err => {
            log.err("onAnyEvent", `An error occurred when calling the command onAnyEvent ${commandName}`, err);
          });
      }
    }

    /*
     +------------------------------------------------+
     |                  ON FIRST CHAT                 |
     +------------------------------------------------+
    */
    async function onFirstChat() {
      if (isMuted) return;
      // Ensure first-chat hooks only fire once per thread.
      if (GoatBot.onFirstChat.has(threadID))
        return;

      const args = body ? body.split(/ +/) : [];
      const commandNames = GoatBot.onFirstChatCommands || GoatBot.onFirstChat._commandNames || [];

      for (const commandName of commandNames) {
        if (isCmdDisabled(threadID, commandName)) continue;
        const command = GoatBot.commands.get(commandName);
        if (!command || !command.onFirstChat)
          continue;

        const getText2 = createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command);
        const time = getTime("DD/MM/YYYY HH:mm:ss");
        createMessageSyntaxError(commandName);

        if (getType(command.onFirstChat) == "Function") {
          const defaultOnFirstChat = command.onFirstChat;
          command.onFirstChat = async function () {
            return defaultOnFirstChat(...arguments);
          };
        }

        command.onFirstChat({
          ...parameters,
          isUserCallCommand,
          args,
          commandName,
          getLang: getText2
        })
          .then(async (handler) => {
            if (typeof handler == "function") {
              if (isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, langCode))
                return;
              try {
                await handler();
                log.info("onFirstChat", `${commandName} | ${userData.name} | ${senderID} | ${threadID} | ${args.join(" ")}`);
              }
              catch (err) {
                await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred2", time, commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
              }
            }
          })
          .catch(err => {
            log.err("onFirstChat", `An error occurred when calling the command onFirstChat ${commandName}`, err);
          });
      }

      GoatBot.onFirstChat.add(threadID);
    }


    /*
     +------------------------------------------------+
     |                    ON REPLY                    |
     +------------------------------------------------+
    */
    async function onReply() {
      if (isMuted) return;
      if (!event.messageReply)
        return;
      const { onReply } = GoatBot;
      const Reply = onReply.get(event.messageReply.messageID);
      if (!Reply)
        return;
      Reply.delete = () => onReply.delete(messageID);
      const commandName = Reply.commandName;
      if (!commandName) {
        message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "cannotFindCommandName"));
        return log.err("onReply", `Can't find command name to execute this reply!`, Reply);
      }
      if (isCmdDisabled(threadID, commandName)) return;
      const command = GoatBot.commands.get(commandName);
      if (!command) {
        message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "cannotFindCommand", commandName));
        return log.err("onReply", `Command "${commandName}" not found`, Reply);
      }

      // —————————————— CHECK PERMISSION —————————————— //
      const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
      const needRole = roleConfig.onReply;
      if (!canUseCommand(role, needRole)) {
        if (!hideNotiMessage.needRoleToUseCmdOnReply) {
          if (needRole == 1)
            return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdminToUseOnReply", commandName));
          else if (needRole == 2)
            return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdminBot2ToUseOnReply", commandName));
          else if (needRole == 3)
            return await message.reply("This command is available to premium members only. Please upgrade your access to continue.");
          else if (needRole == 4)
            return await message.reply("This feature is restricted to the bot developer team.");
        }
        else {
          return true;
        }
      }

      const getText2 = createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command);
      const time = getTime("DD/MM/YYYY HH:mm:ss");
      try {
        if (!command)
          throw new Error(`Cannot find command with commandName: ${commandName}`);
        const args = body ? body.split(/ +/) : [];
        createMessageSyntaxError(commandName);
        if (isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, langCode))
          return;
        await command.onReply({
          ...parameters,
          Reply,
          args,
          commandName,
          getLang: getText2
        });
        log.info("onReply", `${commandName} | ${userData.name} | ${senderID} | ${threadID} | ${args.join(" ")}`);
      }
      catch (err) {
        log.err("onReply", `An error occurred when calling the command onReply ${commandName}`, err);
        await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred3", time, commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
      }
    }


    /*
     +------------------------------------------------+
     |                   ON REACTION                  |
     +------------------------------------------------+
    */
    async function onReaction() {
      if (isMuted) return;
      const { onReaction } = GoatBot;
      const Reaction = onReaction.get(messageID);
      const reaction = event.reaction;

      // Developer unsend reaction feature - works for any bot message
      if ((reaction === "😡" || reaction === "😠") && role >= 4) {
        try {
          await api.unsendMessage(messageID);
          if (Reaction) {
            onReaction.delete(messageID);
          }
          return;
        } catch (err) {
          log.err("onReaction", "Failed to unsend message", err);
        }
      }

      if (!Reaction)
        return;
      Reaction.delete = () => onReaction.delete(messageID);
      const commandName = Reaction.commandName;
      if (!commandName) {
        message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "cannotFindCommandName"));
        return log.err("onReaction", `Can't find command name to execute this reaction!`, Reaction);
      }
      if (isCmdDisabled(threadID, commandName)) return;
      const command = GoatBot.commands.get(commandName);
      if (!command) {
        message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "cannotFindCommand", commandName));
        return log.err("onReaction", `Command "${commandName}" not found`, Reaction);
      }

      // —————————————— CHECK PERMISSION —————————————— //
      const roleConfig = getRoleConfig(utils, command, isGroup, threadData, commandName);
      const needRole = roleConfig.onReaction;
      if (!canUseCommand(role, needRole)) {
        if (!hideNotiMessage.needRoleToUseCmdOnReaction) {
          if (needRole == 1)
            return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdminToUseOnReaction", commandName));
          else if (needRole == 2)
            return await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "onlyAdminBot2ToUseOnReaction", commandName));
          else if (needRole == 3)
            return await message.reply("This command is available to premium members only. Please upgrade your access to continue.");
          else if (needRole == 4)
            return await message.reply("This feature is restricted to the bot developer team.");
        }
        else {
          return true;
        }
      }
      // —————————————————————————————————————————————— //

      const time = getTime("DD/MM/YYYY HH:mm:ss");
      try {
        if (!command)
          throw new Error(`Cannot find command with commandName: ${commandName}`);
        const getText2 = createGetText2(langCode, `${process.cwd()}/languages/cmds/${langCode}.js`, prefix, command);
        const args = [];
        createMessageSyntaxError(commandName);
        if (isBannedOrOnlyAdmin(userData, threadData, senderID, threadID, isGroup, commandName, message, langCode))
          return;
        await command.onReaction({
          ...parameters,
          Reaction,
          args,
          commandName,
          getLang: getText2
        });
        log.info("onReaction", `${commandName} | ${userData.name} | ${senderID} | ${threadID} | ${event.reaction}`);
      }
      catch (err) {
        log.err("onReaction", `An error occurred when calling the command onReaction ${commandName}`, err);
        await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred4", time, commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
      }
    }


    /*
     +------------------------------------------------+
     |                 EVENT COMMAND                  |
     +------------------------------------------------+
    */
    async function handlerEvent() {
      if (isMuted) return;
      const { author } = event;
      const allEventCommand = GoatBot.eventCommands.entries();
      for (const [key] of allEventCommand) {
        const getEvent = GoatBot.eventCommands.get(key);
        if (!getEvent)
          continue;
        const commandName = getEvent.config.name;
        const getText2 = createGetText2(langCode, `${process.cwd()}/languages/events/${langCode}.js`, prefix, getEvent);
        const time = getTime("DD/MM/YYYY HH:mm:ss");
        try {
          const handler = await getEvent.onStart({
            ...parameters,
            commandName,
            getLang: getText2
          });
          if (typeof handler == "function") {
            await handler();
            log.info("EVENT COMMAND", `Event: ${commandName} | ${author} | ${userData.name} | ${threadID}`);
          }
        }
        catch (err) {
          log.err("EVENT COMMAND", `An error occurred when calling the command event ${commandName}`, err);
          await message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred5", time, commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
        }
      }
    }


    /*
     +------------------------------------------------+
     |                    ON EVENT                    |
     +------------------------------------------------+
    */
    async function onEvent() {
      if (isMuted) return;
      const allOnEvent = GoatBot.onEvent || [];
      const args = [];
      const { author } = event;
      for (const key of allOnEvent) {
        if (typeof key !== "string")
          continue;
        const command = GoatBot.commands.get(key);
        if (!command)
          continue;
        const commandName = command.config.name;
        if (isCmdDisabled(threadID, commandName)) continue;
        const time = getTime("DD/MM/YYYY HH:mm:ss");
        createMessageSyntaxError(commandName);

        const getText2 = createGetText2(langCode, `${process.cwd()}/languages/events/${langCode}.js`, prefix, command);

        if (getType(command.onEvent) == "Function") {
          const defaultOnEvent = command.onEvent;
          // convert to AsyncFunction
          command.onEvent = async function () {
            return defaultOnEvent(...arguments);
          };
        }

        command.onEvent({
          ...parameters,
          args,
          commandName,
          getLang: getText2
        })
          .then(async (handler) => {
            if (typeof handler == "function") {
              try {
                await handler();
                log.info("onEvent", `${commandName} | ${author} | ${userData.name} | ${threadID}`);
              }
              catch (err) {
                message.reply(utils.getText({ lang: langCode, head: "handlerEvents" }, "errorOccurred6", time, commandName, removeHomeDir(err.stack ? err.stack.split("\n").slice(0, 5).join("\n") : JSON.stringify(err, null, 2))));
                log.err("onEvent", `An error occurred when calling the command onEvent ${commandName}`, err);
              }
            }
          })
          .catch(err => {
            log.err("onEvent", `An error occurred when calling the command onEvent ${commandName}`, err);
          });
      }
    }

    /*
     +------------------------------------------------+
     |                    PRESENCE                    |
     +------------------------------------------------+
    */
    async function presence() {
      // Your code here
    }

    /*
     +------------------------------------------------+
     |                  READ RECEIPT                  |
     +------------------------------------------------+
    */
    async function read_receipt() {
      // Your code here
    }

    /*
     +------------------------------------------------+
     |                      TYP                       |
     +------------------------------------------------+
    */
    async function typ() {
      // Your code here
    }

    return {
      onAnyEvent,
      onFirstChat,
      onChat,
      onStart,
      onReaction,
      onReply,
      onEvent,
      handlerEvent,
      presence,
      read_receipt,
      typ
    };
  };
};
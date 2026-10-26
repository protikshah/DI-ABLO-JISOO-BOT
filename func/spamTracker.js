/**
 * Dual-level Spam Tracker
 * - Per-user: >5 commands in 15s → ban user 10 minutes
 * - Per-group: >10 commands in 15s → ban group 5 minutes
 * Auto-expires, memory + optional DB sync via handler.
 */
class SpamTracker {
  constructor(options = {}) {
    this.options = {
      userThreshold: options.userThreshold ?? 6,
      userTimeWindow: options.userTimeWindow ?? 15000,
      userBanDuration: options.userBanDuration ?? 10 * 60 * 1000,

      threadThreshold: options.threadThreshold ?? 11,
      threadTimeWindow: options.threadTimeWindow ?? 15000,
      threadBanDuration: options.threadBanDuration ?? 5 * 60 * 1000,

      commandThreshold: options.commandThreshold ?? options.threadThreshold ?? 11,
      timeWindow: options.timeWindow ?? options.threadTimeWindow ?? 15000,
      banDuration: options.banDuration ?? options.threadBanDuration ?? 5 * 60 * 1000,

      maxEntries: options.maxEntries ?? 2000,
      cleanupInterval: options.cleanupInterval ?? 30000,
      ...options
    };

    this.userActivity = new Map();
    this.threadActivity = new Map();
    this.bannedUsers = new Map();
    this.bannedThreads = new Map();

    this.stats = {
      userViolations: 0,
      threadViolations: 0,
      userBans: 0,
      threadBans: 0,
      unbans: 0,
      cleanups: 0
    };

    this.cleanupTimer = setInterval(() => this._cleanup(), this.options.cleanupInterval);
  }

  trackCommand(threadID, userID, commandName = "unknown") {
    const now = Date.now();
    const uid = String(userID);
    const tid = String(threadID);

    const userAlreadyBanned = this._isUserBanned(uid);
    const threadAlreadyBanned = this._isThreadBanned(tid);

    if (userAlreadyBanned || threadAlreadyBanned) {
      return {
        userBanned: userAlreadyBanned,
        threadBanned: threadAlreadyBanned,
        shouldBanUser: false,
        shouldBanThread: false,
        userViolations: 0,
        threadViolations: 0
      };
    }

    let uData = this.userActivity.get(uid);
    if (!uData) {
      uData = { commands: [], lastActivity: now };
      this.userActivity.set(uid, uData);
    }
    uData.commands.push({ command: commandName, timestamp: now, threadID: tid });
    uData.lastActivity = now;
    const uCutoff = now - this.options.userTimeWindow;
    while (uData.commands.length && uData.commands[0].timestamp < uCutoff) {
      uData.commands.shift();
    }
    const userViolations = uData.commands.length;
    const shouldBanUser = userViolations >= this.options.userThreshold;

    let tData = this.threadActivity.get(tid);
    if (!tData) {
      tData = { commands: [], lastActivity: now };
      this.threadActivity.set(tid, tData);
    }
    tData.commands.push({ command: commandName, timestamp: now, userID: uid });
    tData.lastActivity = now;
    const tCutoff = now - this.options.threadTimeWindow;
    while (tData.commands.length && tData.commands[0].timestamp < tCutoff) {
      tData.commands.shift();
    }
    const threadViolations = tData.commands.length;
    const shouldBanThread = threadViolations >= this.options.threadThreshold;

    if (shouldBanUser) {
      this._banUser(uid, "Too many commands in a short time");
      this.stats.userViolations++;
    }
    if (shouldBanThread) {
      this._banThread(tid, "Group command flood detected");
      this.stats.threadViolations++;
    }

    return {
      userBanned: false,
      threadBanned: false,
      shouldBanUser,
      shouldBanThread,
      userViolations,
      threadViolations
    };
  }

  isUserBanned(userID) {
    return this._isUserBanned(String(userID));
  }

  isBanned(threadID) {
    return this._isThreadBanned(String(threadID));
  }

  isThreadBanned(threadID) {
    return this._isThreadBanned(String(threadID));
  }

  getUserBanInfo(userID) {
    return this._getBanInfo(this.bannedUsers, String(userID), () => this._unbanUser(String(userID)));
  }

  getBanInfo(threadID) {
    return this._getBanInfo(this.bannedThreads, String(threadID), () => this._unbanThread(String(threadID)));
  }

  banUser(userID, reason = "Manual ban", duration = null) {
    const uid = String(userID);
    const now = Date.now();
    const banDuration = duration || this.options.userBanDuration;
    this.bannedUsers.set(uid, {
      bannedAt: now,
      expireTime: now + banDuration,
      reason
    });
    this.userActivity.delete(uid);
    this.stats.userBans++;
    return true;
  }

  banThread(threadID, reason = "Manual ban", duration = null) {
    const tid = String(threadID);
    const now = Date.now();
    const banDuration = duration || this.options.threadBanDuration;
    this.bannedThreads.set(tid, {
      bannedAt: now,
      expireTime: now + banDuration,
      reason,
      threadName: null
    });
    this.threadActivity.delete(tid);
    this.stats.threadBans++;
    return true;
  }

  unbanUser(userID) {
    const uid = String(userID);
    if (this.bannedUsers.has(uid)) {
      this._unbanUser(uid);
      return true;
    }
    return false;
  }

  unbanThread(threadID) {
    const tid = String(threadID);
    if (this.bannedThreads.has(tid)) {
      this._unbanThread(tid);
      return true;
    }
    return false;
  }

  getAllBans() {
    const now = Date.now();
    const users = [];
    const threads = [];
    for (const [uid, banData] of this.bannedUsers) {
      if (now > banData.expireTime) this._unbanUser(uid);
      else users.push({ userID: uid, ...banData, remainingTime: banData.expireTime - now });
    }
    for (const [tid, banData] of this.bannedThreads) {
      if (now > banData.expireTime) this._unbanThread(tid);
      else threads.push({ threadID: tid, ...banData, remainingTime: banData.expireTime - now });
    }
    return { users, threads };
  }

  getStats() {
    return {
      ...this.stats,
      trackedUsers: this.userActivity.size,
      trackedThreads: this.threadActivity.size,
      bannedUsers: this.bannedUsers.size,
      bannedThreads: this.bannedThreads.size
    };
  }

  reset() {
    this.userActivity.clear();
    this.threadActivity.clear();
    this.bannedUsers.clear();
    this.bannedThreads.clear();
    this.stats = { userViolations: 0, threadViolations: 0, userBans: 0, threadBans: 0, unbans: 0, cleanups: 0 };
  }

  destroy() {
    clearInterval(this.cleanupTimer);
    this.reset();
  }

  _isUserBanned(uid) {
    const ban = this.bannedUsers.get(uid);
    if (!ban) return false;
    if (Date.now() > ban.expireTime) {
      this._unbanUser(uid);
      return false;
    }
    return true;
  }

  _isThreadBanned(tid) {
    const ban = this.bannedThreads.get(tid);
    if (!ban) return false;
    if (Date.now() > ban.expireTime) {
      this._unbanThread(tid);
      return false;
    }
    return true;
  }

  _getBanInfo(map, id, unbanFn) {
    const ban = map.get(id);
    if (!ban) return null;
    const now = Date.now();
    if (now > ban.expireTime) {
      unbanFn();
      return null;
    }
    return { ...ban, remainingTime: ban.expireTime - now };
  }

  _banUser(uid, reason) {
    const now = Date.now();
    this.bannedUsers.set(uid, {
      bannedAt: now,
      expireTime: now + this.options.userBanDuration,
      reason
    });
    this.userActivity.delete(uid);
    this.stats.userBans++;
  }

  _banThread(tid, reason) {
    const now = Date.now();
    this.bannedThreads.set(tid, {
      bannedAt: now,
      expireTime: now + this.options.threadBanDuration,
      reason,
      threadName: null
    });
    this.threadActivity.delete(tid);
    this.stats.threadBans++;
  }

  _unbanUser(uid) {
    this.bannedUsers.delete(uid);
    this.stats.unbans++;
  }

  _unbanThread(tid) {
    this.bannedThreads.delete(tid);
    this.stats.unbans++;
  }

  _cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [uid, ban] of this.bannedUsers) {
      if (now > ban.expireTime) {
        this._unbanUser(uid);
        cleaned++;
      }
    }
    for (const [tid, ban] of this.bannedThreads) {
      if (now > ban.expireTime) {
        this._unbanThread(tid);
        cleaned++;
      }
    }

    const uCutoff = now - this.options.userTimeWindow * 2;
    for (const [uid, data] of this.userActivity) {
      if (data.lastActivity < uCutoff) {
        this.userActivity.delete(uid);
        cleaned++;
      } else {
        while (data.commands.length && data.commands[0].timestamp < now - this.options.userTimeWindow) {
          data.commands.shift();
        }
      }
    }

    const tCutoff = now - this.options.threadTimeWindow * 2;
    for (const [tid, data] of this.threadActivity) {
      if (data.lastActivity < tCutoff) {
        this.threadActivity.delete(tid);
        cleaned++;
      } else {
        while (data.commands.length && data.commands[0].timestamp < now - this.options.threadTimeWindow) {
          data.commands.shift();
        }
      }
    }

    if (this.userActivity.size > this.options.maxEntries) {
      const sorted = [...this.userActivity.entries()].sort((a, b) => a[1].lastActivity - b[1].lastActivity);
      for (let i = 0; i < sorted.length - this.options.maxEntries; i++) {
        this.userActivity.delete(sorted[i][0]);
        cleaned++;
      }
    }
    if (this.threadActivity.size > this.options.maxEntries) {
      const sorted = [...this.threadActivity.entries()].sort((a, b) => a[1].lastActivity - b[1].lastActivity);
      for (let i = 0; i < sorted.length - this.options.maxEntries; i++) {
        this.threadActivity.delete(sorted[i][0]);
        cleaned++;
      }
    }

    this.stats.cleanups += cleaned;
  }
}

module.exports = SpamTracker;

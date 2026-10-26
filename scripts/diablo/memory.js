// ============================================================
// REPLY MEMORY - GoatBot onReply bypass
// ============================================================

const replyMemory = new Map();
const confirmationMemory = new Map();
const MEMORY_TTL = 30 * 60 * 1000; // 30 min

// ---- Bot message memory (reply target) ----
function rememberBotMsg(messageID, data) {
  replyMemory.set(String(messageID), { ...data, ts: Date.now() });
  cleanup(replyMemory);
}

function getBotMsg(messageID) {
  const m = replyMemory.get(String(messageID));
  if (!m) return null;
  if (Date.now() - m.ts > MEMORY_TTL) {
    replyMemory.delete(String(messageID));
    return null;
  }
  return m;
}

function forgetBotMsg(messageID) {
  replyMemory.delete(String(messageID));
}

// ---- Confirmation memory (dangerous command) ----
function rememberConfirmation(messageID, data) {
  confirmationMemory.set(String(messageID), { ...data, ts: Date.now() });
  cleanup(confirmationMemory);
}

function getConfirmation(messageID) {
  const m = confirmationMemory.get(String(messageID));
  if (!m) return null;
  if (Date.now() - m.ts > MEMORY_TTL) {
    confirmationMemory.delete(String(messageID));
    return null;
  }
  return m;
}

function forgetConfirmation(messageID) {
  confirmationMemory.delete(String(messageID));
}

// ---- Cleanup helper ----
function cleanup(map) {
  if (map.size < 500) return;
  const now = Date.now();
  for (const [k, v] of map) {
    if (now - v.ts > MEMORY_TTL) map.delete(k);
  }
}

module.exports = {
  rememberBotMsg,
  getBotMsg,
  forgetBotMsg,
  rememberConfirmation,
  getConfirmation,
  forgetConfirmation
};

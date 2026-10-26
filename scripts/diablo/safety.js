// ============================================================
// SAFETY - Dangerous/Reject command filter
// ============================================================

// ❌ AUTO-REJECT (AI ধরবেই না)
const REJECT_COMMANDS = [
  "eval", "shell", "file", "cmd", "cmdconfig",
  "backupdate", "loadconfig",
  "spy", "spy2", "spy3", "spy4",
  "callad", "smsbomber",
  "addfriend", "autoaddfriend"
];

// 🚨 CONFIRM লাগবে
const CONFIRM_COMMANDS = [
  "ummah", "kick", "makeadmin", "promote", "demote",
  "suspended", "ban", "kickall",
  "out", "leave",
  "adminonly", "lock", "onlyadminbox",
  "prefix", "manageprefix", "set",
  "accountswitch", "unsend", "warn",
  "restart", "antioout", "antichangeinfobox",
  "wlg", "setwelcome", "setname", "settheme",
  "autosetname", "sendnoti", "sendmsg"
];

function isReject(action) {
  if (!action) return true;
  return REJECT_COMMANDS.includes(String(action).toLowerCase());
}

function needsConfirm(action) {
  if (!action) return false;
  return CONFIRM_COMMANDS.includes(String(action).toLowerCase());
}

function isSafe(action) {
  return !isReject(action) && !needsConfirm(action);
}

module.exports = {
  REJECT_COMMANDS,
  CONFIRM_COMMANDS,
  isReject,
  needsConfirm,
  isSafe
};

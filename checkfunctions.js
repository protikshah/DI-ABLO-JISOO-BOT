const fs = require("fs");
const path = require("path");

const cmdsDir = path.join(__dirname, "scripts", "cmds");
const filesToCheck = ["activestatus.js", "friendlist.js", "note.js", "pin.js", "wlg.js"];

// top-level object property যেগুলা function (async function key, key: function, key: async (...) =>)
const funcPattern = /^\s{0,4}(\w+)\s*:\s*(async\s+function|function|async\s*\(|\([^)]*\)\s*=>)/gm;

for (const file of filesToCheck) {
  const fullPath = path.join(cmdsDir, file);
  const content = fs.readFileSync(fullPath, "utf8");

  const matches = [...content.matchAll(funcPattern)].map(m => m[1]);
  const uniqueMatches = [...new Set(matches)];

  console.log(`\n===== ${file} =====`);
  console.log(uniqueMatches.length ? uniqueMatches.join(", ") : "কোনো ফাংশন-প্যাটার্ন মিলেনি");
}
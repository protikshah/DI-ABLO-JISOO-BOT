const fs = require("fs");
const path = require("path");

const cmdsDir = path.join(__dirname, "scripts", "cmds");

// এই ফাইলগুলাতে onStart এর বদলে ST নামে ফাংশন আছে
const brokenFiles = [
  "activestatus.js", "friendlist.js", "note.js", "pin.js", "wlg.js"
];

let fixedCount = 0;
let skippedCount = 0;

for (const file of brokenFiles) {
  const fullPath = path.join(cmdsDir, file);

  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️ ${file} not found, skipping.`);
    skippedCount++;
    continue;
  }

  let content = fs.readFileSync(fullPath, "utf8");

  // যদি আগে থেকেই onStart alias করা থাকে, স্কিপ কর
  if (content.includes("module.exports.onStart")) {
    console.log(`✅ ${file} already patched, skipping.`);
    skippedCount++;
    continue;
  }

  // ফাইলের শেষে alias লাইন যোগ কর
  const patch = `\n\n// --- Auto-patched: alias ST as onStart ---\nif (typeof module.exports.ST === "function" && !module.exports.onStart) {\n  module.exports.onStart = module.exports.ST;\n}\n`;

  content += patch;
  fs.writeFileSync(fullPath, content, "utf8");
  console.log(`🔧 Patched: ${file}`);
  fixedCount++;
}

console.log(`\n===== DONE =====`);
console.log(`Fixed: ${fixedCount} | Skipped: ${skippedCount}`);
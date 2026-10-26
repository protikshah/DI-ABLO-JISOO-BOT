const fs = require("fs");
const path = require("path");

const cmdsDir = path.join(__dirname, "scripts", "cmds");
const filesToCheck = ["activestatus.js", "friendlist.js", "note.js", "pin.js", "wlg.js"];

for (const file of filesToCheck) {
  const fullPath = path.join(cmdsDir, file);
  const content = fs.readFileSync(fullPath, "utf8");

  // module.exports = { ... } ব্লকের ভিতরে থাকা function-এর মতো keys খুঁজে বের করার চেষ্টা
  const match = content.match(/module\.exports\s*=\s*{([\s\S]{0,500})/);
  console.log(`\n===== ${file} =====`);
  console.log(match ? match[1].split(",").map(s => s.trim().split(":")[0].trim()).slice(0, 10).join(", ") : "প্যাটার্ন মিলেনি, ম্যানুয়াল চেক দরকার");
}
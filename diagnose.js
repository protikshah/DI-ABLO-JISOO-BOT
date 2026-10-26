const fs = require("fs");
const path = require("path");

const cmdsDir = path.join(__dirname, "scripts", "cmds");
const files = fs.readdirSync(cmdsDir).filter(f => f.endsWith(".js"));

const report = [];

for (const file of files) {
  const fullPath = path.join(cmdsDir, file);
  try {
    delete require.cache[require.resolve(fullPath)];
    const mod = require(fullPath);

    if (typeof mod.onStart !== "function") {
      const keys = Object.keys(mod);
      report.push(`❌ ${file} -> missing onStart. Exported keys: [${keys.join(", ")}]`);
    }
  } catch (err) {
    report.push(`💥 ${file} -> CRASHED on require: ${err.message}`);
  }
}

console.log("\n===== DIAGNOSIS REPORT =====\n");
if (report.length === 0) {
  console.log("সব ঠিক আছে!");
} else {
  report.forEach(line => console.log(line));
}
console.log(`\nTotal problematic files: ${report.length}`);
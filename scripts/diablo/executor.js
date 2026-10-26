// ============================================================
// EXECUTOR - Command চালানোর জন্য
// ============================================================

const path = require("path");

async function executeCommand({ action, params, api, event, usersData, threadsData, message }) {
  try {
    // Command file locate
    const cmdPath = path.join(__dirname, "..", "cmds", `${action}.js`);

    let cmdModule;
    try {
      // Cache clear করে fresh load
      delete require.cache[require.resolve(cmdPath)];
      cmdModule = require(cmdPath);
    } catch (e) {
      throw new Error(`Command "${action}" not found: ${e.message}`);
    }

    if (!cmdModule || typeof cmdModule.onStart !== "function") {
      throw new Error(`Command "${action}" has no onStart function`);
    }

    // Modified event তৈরি
    const modifiedEvent = {
      ...event,
      args: buildArgs(action, params),
      body: `#${action} ${buildArgs(action, params).join(" ")}`.trim(),
      _fromDiablo: true
    };

    // Execute
    await cmdModule.onStart({
      api,
      event: modifiedEvent,
      args: modifiedEvent.args,
      message,
      usersData,
      threadsData
    });

    return { success: true };
  } catch (e) {
    console.error(`[DIABLO EXECUTOR] "${action}" failed:`, e.message);
    return { success: false, error: e.message };
  }
}

// Build args array based on params
function buildArgs(action, params) {
  if (!params || typeof params !== "object") return [];

  const args = [];

  // Query
  if (params.query) {
    args.push(...String(params.query).split(/\s+/));
  }

  // Effect
  if (params.effect) {
    args.push(`-${params.effect}`);
  }

  // Language
  if (params.language) {
    args.push(`-${params.language}`);
  }

  // Flags
  if (Array.isArray(params.flags)) {
    args.push(...params.flags);
  }

  return args;
}

module.exports = { executeCommand };

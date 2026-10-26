# DI-ABLO JIsoo

Messenger bot based on **GoatBot V2** + **fca-protik**.  
Prefix: `zx` · Economy, VIP, games, media, utility (~500 commands).

> **Public release notes:** Scrubbed `account.txt` and Mongo URI. Set your own credentials before running.

---

## Requirements

- Node.js **20.x**
- MongoDB (Atlas recommended on cloud hosts)
- Facebook account cookie / appstate JSON

---

## Quick start (PC)

```bash
npm install
# 1) Paste appstate JSON array into account.txt
# 2) Edit config.json → database.uriMongodb  OR set env MONGODB_URI
# 3) Put your Facebook UID in config.json → adminBot + vipOwner
# 4) Put same UIDs in func/vipConfig.js → ADMIN_UIDS
npm start
```

### Render / Railway

| Setting | Value |
|---------|--------|
| `NODE_VERSION` | `20.18.1` |
| `MONGODB_URI` | your Atlas URI |
| Start | `npm start` |

Prefer MongoDB only (sqlite can fail on some hosts). `canvas` needs Node 20.

---

## UID lock (fork checklist)

Change these to **your** Facebook user IDs:

| File | Keys |
|------|------|
| `config.json` | `adminBot`, `vipOwner`, `devUsers`, `premiumUsers` |
| `func/vipConfig.js` | `ADMIN_UIDS` |
| Some cmds | Hardcoded owner checks (e.g. `vip` add/remove) |

Without this, VIP admin and owner-only commands will not work for you.

---

## VIP system

- Buy: `zx vip buy 1|2|5|10` (price from `config.vip` / `vipConfig.PRICING`)
- Info: `zx vip` · List: `zx vip list`
- Owner add/remove: `zx vip add` / `zx vip remove` (ADMIN_UIDS only)
- VIP-only commands: list in `func/vipConfig.js` → `VIP_ONLY`
- Gate: `bot/handler/handlerEvents.js` checks `isVipActive` before run
- Bonus: win-rate games `WIN_BOOST`, quiz bonus `QUIZ_BONUS`

---

## Daily tasks (anti fake-play)

File: `scripts/cmds/task.js`

- Chat/mention tasks still count from group activity.
- **Game tasks no longer count** if you only type the game name.
- Progress increases when a game finishes a **real round** and calls:

```js
const task = require("./task");
await task.recordPlay(senderID, "crash", api, threadID, messageID);
```

Supported keys: `crash`, `jisoo`, `dil`, `slotjisoo`, `actor`, `cartoon`, `flag`, `maze`, `ttt`, `animeqz`, `girl99`.

Hooked in the corresponding command files after bet / correct answer where applicable.

---

## Author credit / security

- Every command file should keep its original `config.author` string.
- Some files (e.g. `girl99`) **hard-lock** on author name: changing it disables the command.
- Soft policy for public forks: do not strip credits; see **CREDITS.md**.
- Optional hard lock pattern:

```js
const allowedAuthors = ["Original Name"];
if (!allowedAuthors.some(a => (this.config.author || "").includes(a))) {
  return api.sendMessage("Unauthorized author modification.", threadID, messageID);
}
```

There is **no global** author lock in the loader by default (fork-friendly). Enable per-command if you want.

---

## Spam protection

`config.json` → `spamProtection`:

- User: >5 commands in 15s → ban **user** 10 minutes  
- Group: >10 commands in 15s → ban **group** 5 minutes  

---

## Main folders

```
bot/handler/     # events + VIP gate + spam
func/            # vipManager, vipConfig, spamTracker, …
scripts/cmds/    # commands
scripts/events/  # welcome, leave, …
config.json      # prefix, admin, db, vip, spam
account.txt      # Facebook appstate (do not commit real cookies)
```

---

## Security

- Never commit real `account.txt` or live Mongo passwords.
- Rotate Atlas password if this repo was ever public with secrets.
- Use `.gitignore` for `account.txt`, `.env`, logs, `cache/`.

---

## Credits

Base framework: [Goat-Bot-V2](https://github.com/ntkhang03/Goat-Bot-V2) (NTKhang)  
FCA: fca-protik  

Full command author list: **[CREDITS.md](./CREDITS.md)**

---

## License

MIT (respect individual command authors’ credits).

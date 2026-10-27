# Forum Permission Bot

A Discord bot that enforces per-thread posting restrictions in forum channels and can monitor honeypot channels. In monitored forum threads, only the thread author (OP) and configured staff roles can reply. In honeypot channels, any non-staff account that sends a message is immediately banned.

## How it works

1. A user creates a thread in a monitored forum channel (e.g. `#mod-news`)
2. Someone without permission posts a reply
3. The bot deletes the message and posts in the notification channel:
   > @User Your message in #thread-name was removed — only the thread author and staff may post there. Please read the rules: #rules

For honeypot channels:

1. Add one or more channel IDs to `honeypotChannelIds`
2. Any account without a configured staff role that posts in one of those channels is banned
3. The bot requests Discord to delete the banned account's last 60 minutes of messages

## Setup

### Prerequisites

- Node.js 18+ (or Docker)
- A Discord application with a bot token — [discord.com/developers/applications](https://discord.com/developers/applications)

### 1. Enable Privileged Intents

In the Discord Developer Portal, go to your app → **Bot** and enable:
- **Server Members Intent**
- **Message Content Intent**

### 2. Invite the bot

Use OAuth2 → URL Generator with scope `bot` and permissions:
- View Channels
- Read Message History
- Manage Messages
- Send Messages
- Ban Members

### 3. Configure the bot

Copy `.env.example` to `.env` and fill in your bot token:

```
BOT_TOKEN=your_token_here
```

Edit `config.json`:

```json
{
  "forumChannelIds": ["ID of the forum channel(s) to monitor"],
  "staffRoleIds":    ["Role ID(s) that can always post in any thread"],
  "honeypotChannelIds": ["ID of honeypot channel(s) where non-staff posts cause an instant ban"],
  "notificationChannelId": "Channel ID where violation notices are posted",
  "rulesChannelId":        "Channel or thread ID linked in violation notices"
}
```

To get IDs: enable Developer Mode in Discord settings, then right-click any channel, role, or thread → **Copy ID**.

### 4. Run

```bash
npm install
npm start
```

For development with auto-restart:

```bash
npm run dev
```

## Docker / Portainer

Build and run with Docker Compose:

```bash
BOT_TOKEN=your_token_here docker compose up -d
```

For Portainer Stacks:

1. Push this repo to Git (`.env` is gitignored — the token stays local)
2. **Stacks → Add stack → Repository**, point at your repo
3. Add `BOT_TOKEN` under **Environment variables**
4. Deploy

The container is configured with `restart: unless-stopped`, so it survives crashes and server reboots automatically.

## Translator notices

Mr. Redux can post new and updated English source keys from Weblate to the
KSP2 Redux translators channel or thread. Set `WEBLATE_NOTIFY_TOKEN` to a Weblate API token
with read access to the `ksp2redux` project, `WEBLATE_NOTIFY_GUILD_ID` to
`1078696971088433153`, and `WEBLATE_NOTIFY_CHANNEL_ID` to `1564471939446349925`.
The older `WEBLATE_NOTIFY_THREAD_ID` setting remains supported for existing
thread deployments. Leaving both destination settings empty disables this feature.

The bot polls Weblate's project change history every 15 seconds. Each newly
observed English source change resets a 60-second quiet timer. Repeated edits
to the same key are combined; translation-only changes and status/label edits
do not produce notices. Source changes made through the API, browser, uploads
and repository imports are covered. The first start establishes a baseline
without announcing existing history.

Each batch lists every changed key with its direct Weblate source link. Large
batches use numbered parts to fit Discord's limits. Entries without a key, such
as glossary terms, use their English source text as the link label. Recipients
choose their translation language in Weblate. Notices do not ping users or roles.

Pending batches, change cursors and delivery receipts persist in the
`translator_notices` volume. Interrupted sends recover from thread history and
use Discord nonces to avoid duplicates. Deleted keys and edits reverted during
the batching window are omitted. Failed API reads retain the cursor and batch
for retry. The source token needs no editing, upload or repository permissions.

The bot requires View Channel, Send Messages, Embed Links and Read Message History
in a text channel, or Send Messages in Threads when the destination is a thread.
Archived, unlocked threads are reopened
when posting; locked threads retain pending notices until they become available.
`WEBLATE_NOTIFY_URL`, `WEBLATE_NOTIFY_PROJECT` and `WEBLATE_NOTIFY_STATE_PATH`
override the defaults `https://translate.ksp2redux.org`, `ksp2redux` and
`/data/weblate-notices.json`. The container health check monitors successful
notification cycles. Notification failures leave moderation running.

Run `npm ci` and `npm test` to check batching, source filtering, persistence,
retries, duplicate recovery and complete large-batch formatting.

## Project structure

```
├── index.js                    # Bot entry point
├── config.json                 # Channel and role IDs
├── src/
│   ├── config.js               # Config loader and validator
│   └── handlers/
│       └── messageCreate.js    # Core permission enforcement logic
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── .gitignore
```

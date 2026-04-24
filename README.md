# Forum Permission Bot

A Discord bot that enforces per-thread posting restrictions in forum channels. When a thread is created in a monitored forum, only the thread author (OP) and configured staff roles can reply. Any other message is deleted and the offending user is notified in a designated channel.

## How it works

1. A user creates a thread in a monitored forum channel (e.g. `#mod-news`)
2. Someone without permission posts a reply
3. The bot deletes the message and posts in the notification channel:
   > @User Your message in #thread-name was removed — only the thread author and staff may post there. Please read the rules: #rules

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

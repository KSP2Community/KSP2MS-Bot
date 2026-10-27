require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./src/config');
const handleMessageCreate = require('./src/handlers/messageCreate');
const { settings } = require('./src/weblate/client');
const { TranslatorNotices } = require('./src/weblate/service');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
  ],
});

let notices;
client.once('clientReady', async () => {
  console.log(`[ready] Logged in as ${client.user.tag}`);
  console.log(`[ready] Monitoring ${config.forumChannelIds.length} forum channel(s)`);
  console.log(`[ready] Monitoring ${config.honeypotChannelIds.length} honeypot channel(s)`);
  try {
    const notificationSettings = settings();
    if (notificationSettings) {
      notices = new TranslatorNotices(client, notificationSettings);
      await notices.start();
    }
  } catch {
    console.error('[weblate] Translator notices could not start. Check configuration, credentials and thread permissions; moderation remains active.');
  }
});

client.on('messageCreate', message => handleMessageCreate(message, client, config));

client.login(process.env.BOT_TOKEN).catch(err => {
  console.error('[login] Failed to log in:', err.message);
  process.exit(1);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    if (notices) await notices.stop();
    client.destroy();
    process.exit(0);
  });
}

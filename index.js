require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./src/config');
const handleMessageCreate = require('./src/handlers/messageCreate');

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

client.once('clientReady', () => {
  console.log(`[ready] Logged in as ${client.user.tag}`);
  console.log(`[ready] Monitoring ${config.forumChannelIds.length} forum channel(s)`);
});

client.on('messageCreate', message => handleMessageCreate(message, client, config));

client.login(process.env.BOT_TOKEN).catch(err => {
  console.error('[login] Failed to log in:', err.message);
  process.exit(1);
});

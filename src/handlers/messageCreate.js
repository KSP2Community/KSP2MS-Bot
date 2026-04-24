module.exports = async function handleMessageCreate(message, client, config) {
  if (message.author.bot) return;
  if (!message.channel.isThread()) return;
  if (!config.forumChannelIds.includes(message.channel.parentId)) return;

  // The thread starter message shares its ID with the thread itself — always by the OP
  if (message.id === message.channel.id) return;

  const thread = message.channel;

  // Resolve guild member (may not be cached if GuildMembers intent is missing)
  let member = message.member;
  if (!member) {
    try {
      member = await message.guild.members.fetch(message.author.id);
    } catch {
      // Member left or fetch failed — treat as unauthorized
    }
  }

  // OP check
  if (message.author.id === thread.ownerId) return;

  // Staff role check
  if (member && config.staffRoleIds.some(roleId => member.roles.cache.has(roleId))) return;

  // Not allowed — delete and notify
  try {
    await message.delete();
  } catch (err) {
    console.error(`[messageCreate] Failed to delete message ${message.id}:`, err.message);
  }

  const notifChannel = client.channels.cache.get(config.notificationChannelId);
  if (!notifChannel) {
    console.warn('[messageCreate] Notification channel not found — check notificationChannelId in config.json');
    return;
  }

  try {
    await notifChannel.send(
      `${message.author} Your message in ${thread} was removed — ` +
      `only the thread author and staff may post there. ` +
      `Please read the rules: <#${config.rulesChannelId}>`
    );
  } catch (err) {
    console.error('[messageCreate] Failed to send notification:', err.message);
  }
};

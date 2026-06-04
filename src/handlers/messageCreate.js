async function resolveMember(message) {
  let member = message.member;
  if (!member) {
    try {
      member = await message.guild.members.fetch(message.author.id);
    } catch {
      // Member left or fetch failed — treat as unauthorized
    }
  }

  return member;
}

function isStaff(member, config) {
  return member && config.staffRoleIds.some(roleId => member.roles.cache.has(roleId));
}

async function handleHoneypotMessage(message, config) {
  if (!message.guild || !config.honeypotChannelIds.includes(message.channelId)) return false;

  const member = await resolveMember(message);
  if (isStaff(member, config)) return true;

  const reason = `Honeypot channel message in #${message.channel.name || message.channelId}`;

  try {
    await message.guild.members.ban(message.author.id, {
      reason,
      deleteMessageSeconds: 60 * 60,
    });
    console.log(`[honeypot] Banned ${message.author.tag} (${message.author.id}) for posting in ${message.channelId}`);
  } catch (err) {
    console.error(`[honeypot] Failed to ban ${message.author.tag} (${message.author.id}):`, err.message);
  }

  return true;
}

module.exports = async function handleMessageCreate(message, client, config) {
  if (await handleHoneypotMessage(message, config)) return;

  if (message.author.bot) return;
  if (!message.channel.isThread()) return;
  if (!config.forumChannelIds.includes(message.channel.parentId)) return;

  // The thread starter message shares its ID with the thread itself — always by the OP
  if (message.id === message.channel.id) return;

  const thread = message.channel;

  const member = await resolveMember(message);

  // OP check
  if (message.author.id === thread.ownerId) return;

  // Staff role check
  if (isStaff(member, config)) return;

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

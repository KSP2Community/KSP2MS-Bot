const raw = require('../config.json');

const errors = [];

if (!Array.isArray(raw.forumChannelIds) || raw.forumChannelIds.length === 0) {
  errors.push('forumChannelIds must be a non-empty array');
}
if (!Array.isArray(raw.staffRoleIds) || raw.staffRoleIds.length === 0) {
  errors.push('staffRoleIds must be a non-empty array');
}
if (!Array.isArray(raw.honeypotChannelIds)) {
  errors.push('honeypotChannelIds must be an array');
}
if (!raw.notificationChannelId || typeof raw.notificationChannelId !== 'string') {
  errors.push('notificationChannelId must be a non-empty string');
}
if (!raw.rulesChannelId || typeof raw.rulesChannelId !== 'string') {
  errors.push('rulesChannelId must be a non-empty string');
}

if (errors.length > 0) {
  console.error('[config] Invalid config.json:');
  errors.forEach(e => console.error(` - ${e}`));
  process.exit(1);
}

module.exports = raw;

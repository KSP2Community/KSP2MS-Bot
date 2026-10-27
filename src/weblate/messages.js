const crypto = require('node:crypto');
const { NotificationError } = require('./client');

function signature(unit) {
  return crypto.createHash('sha256').update(JSON.stringify([unit.key, unit.source])).digest('hex');
}

function escape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/([*_`~|\[\]<>])/g, '\\$1').replace(/[\r\n]+/g, ' ');
}

function messages(units, timestamp, projectUrl) {
  const sorted = [...units].sort((a, b) => a.component.localeCompare(b.component) || Number(b.added) - Number(a.added) || a.key.localeCompare(b.key));
  const descriptions = [];
  let lines = [];
  let component = '';
  for (const unit of sorted) {
    const heading = `**${escape(unit.component.replaceAll('/', ' / '))}**`;
    const line = `• **${unit.added ? 'Added' : 'Updated'}** [${escape(unit.key)}](${unit.url})`;
    if (line.length + heading.length > 3800) throw new NotificationError('A source key is too long for a Discord notice; the complete batch is retained for review.');
    const extra = component !== unit.component ? [heading, line] : [line];
    if ([...lines, ...extra].join('\n').length > 3800) {
      descriptions.push(lines.join('\n'));
      lines = [heading, line];
    } else lines.push(...extra);
    component = unit.component;
  }
  if (lines.length) descriptions.push(lines.join('\n'));
  const added = units.filter(unit => unit.added).length;
  return descriptions.map((description, index) => ({
    content: index === 0 ? `**${added} added · ${units.length - added} updated English source strings**\nOpen a key in Weblate, then choose your translation language.` : '',
    allowed_mentions: { parse: [] },
    embeds: [{ title: 'English source updates' + (descriptions.length > 1 ? ` · ${index + 1}/${descriptions.length}` : ''),
      url: projectUrl, description, color: 0x2ecc71, timestamp: new Date(timestamp).toISOString(),
      footer: { text: 'Weblate · English source strings' } }],
  }));
}

function sameMessage(message, payload, author) {
  if (message.author?.id !== author || (message.content || '') !== payload.content || message.embeds?.length !== payload.embeds.length) return false;
  return payload.embeds.every((embed, index) => {
    const actual = message.embeds[index];
    return actual.title === embed.title && actual.description === embed.description && actual.url === embed.url &&
      actual.color === embed.color && actual.footer?.text === embed.footer.text &&
      Date.parse(actual.timestamp) === Date.parse(embed.timestamp);
  });
}

module.exports = { signature, messages, sameMessage };

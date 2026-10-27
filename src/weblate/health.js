const fs = require('node:fs');

const target = process.env.WEBLATE_NOTIFY_CHANNEL_ID || process.env.WEBLATE_NOTIFY_THREAD_ID;
if (target) {
  try {
    const state = JSON.parse(fs.readFileSync(process.env.WEBLATE_NOTIFY_STATE_PATH || '/data/weblate-notices.json', 'utf8'));
    if (state.version !== 1 || state.baselineId === null || !state.lastSuccess || Date.now() - state.lastSuccess > 120000 ||
        state.binding.thread !== target) process.exit(1);
  } catch {
    process.exit(1);
  }
}

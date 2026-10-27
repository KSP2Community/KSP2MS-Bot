const fs = require('node:fs');

if (process.env.WEBLATE_NOTIFY_THREAD_ID) {
  try {
    const state = JSON.parse(fs.readFileSync(process.env.WEBLATE_NOTIFY_STATE_PATH || '/data/weblate-notices.json', 'utf8'));
    if (state.version !== 1 || state.baselineId === null || !state.lastSuccess || Date.now() - state.lastSuccess > 120000 ||
        state.binding.thread !== process.env.WEBLATE_NOTIFY_THREAD_ID) process.exit(1);
  } catch {
    process.exit(1);
  }
}

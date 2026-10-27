const { URL } = require('node:url');

// Includes PO-mono English edits, where Weblate records a translation change
// on the source unit, as well as explicit source-edit/import events.
const ADDED = new Set([13, 31, 71, 73, 89, 90]);
const SOURCE = new Set([13, 30, 89, 90]);
const ACTIONS = [...new Set([...ADDED, ...SOURCE, 2, 5, 6, 7, 8, 9, 27, 59, 72, 74, 77])];

class NotificationError extends Error {}

function settings(env = process.env) {
  const target = env.WEBLATE_NOTIFY_CHANNEL_ID || env.WEBLATE_NOTIFY_THREAD_ID;
  if (!target) return null;
  const result = {
    // Keep the internal field and persisted binding compatible with existing
    // thread deployments; Discord uses channel IDs for both destination types.
    threadId: target,
    guildId: env.WEBLATE_NOTIFY_GUILD_ID,
    token: env.WEBLATE_NOTIFY_TOKEN,
    base: (env.WEBLATE_NOTIFY_URL || 'https://translate.ksp2redux.org').replace(/\/$/, ''),
    project: env.WEBLATE_NOTIFY_PROJECT || 'ksp2redux',
    statePath: env.WEBLATE_NOTIFY_STATE_PATH || '/data/weblate-notices.json',
  };
  if (!/^\d{17,20}$/.test(result.threadId) || !/^\d{17,20}$/.test(result.guildId || '') ||
      !result.token || new URL(result.base).protocol !== 'https:' || !/^[\w-]+$/.test(result.project)) {
    throw new NotificationError('Translator notices require a guild, channel or thread, HTTPS Weblate URL and read-only API token.');
  }
  return result;
}

function candidate(change, config) {
  if (!Number.isSafeInteger(change.id) || !Number.isFinite(Date.parse(change.timestamp)) ||
      !ACTIONS.includes(change.action) || !change.unit || !change.component) return null;
  const componentPrefix = `${config.base}/api/components/${config.project}/`;
  const translationPrefix = `${config.base}/api/translations/${config.project}/`;
  if (!change.component.startsWith(componentPrefix)) return null;
  const english = typeof change.translation === 'string' && change.translation.startsWith(translationPrefix) &&
    new URL(change.translation).pathname.endsWith('/en/');
  if (!english && !SOURCE.has(change.action)) return null;
  if (!ADDED.has(change.action) && !SOURCE.has(change.action) && change.old === change.target) return null;
  const context = typeof change.details?.context === 'string' ? change.details.context : '';
  return {
    id: change.id, timestamp: change.timestamp, unit: change.unit, component: change.component,
    context, old: typeof change.old === 'string' ? change.old : null,
    oldContext: change.details?.old_context || context,
    added: ADDED.has(change.action), force: SOURCE.has(change.action),
  };
}

class Weblate {
  constructor(config, request = fetch) {
    this.config = config;
    this.request = request;
  }

  async get(value, { missing = false } = {}) {
    const url = new URL(value, `${this.config.base}/api/`);
    if (url.origin !== new URL(this.config.base).origin || !url.pathname.startsWith('/api/') ||
        url.username || url.password) throw new NotificationError('Weblate returned an unexpected API address.');
    let response;
    try {
      response = await this.request(url, {
        headers: { Authorization: `Token ${this.config.token}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new NotificationError('Weblate could not be reached. Translator notices will retry.');
    }
    if (response.status === 404 && missing) return null;
    if (!response.ok) throw new NotificationError(`Weblate returned HTTP ${response.status}. Translator notices will retry.`);
    return response.json();
  }

  async latest() {
    const page = await this.get(`projects/${this.config.project}/changes/?page_size=1`);
    return page.results[0] || { id: 0, timestamp: new Date().toISOString() };
  }

  async changes(after, before) {
    const query = new URLSearchParams({ timestamp_after: after, timestamp_before: before, page_size: '1000' });
    for (const action of ACTIONS) query.append('action', String(action));
    const prefix = `${this.config.base}/api/projects/${this.config.project}/changes/`;
    let url = prefix + '?' + query;
    const rows = [];
    const visited = new Set();
    while (url) {
      if (!url.startsWith(prefix) || visited.has(url)) throw new NotificationError('Weblate returned invalid changes pagination.');
      visited.add(url);
      const page = await this.get(url);
      if (!Array.isArray(page.results)) throw new NotificationError('Weblate returned an invalid changes response.');
      rows.push(...page.results);
      url = page.next;
    }
    return rows.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id - b.id);
  }

  async source(entry) {
    if (!entry.unit.startsWith(`${this.config.base}/api/units/`)) throw new NotificationError('Invalid source unit address.');
    let unit = await this.get(entry.unit, { missing: true });
    if (!unit) return null;
    if (unit.source_unit && unit.source_unit !== unit.url) unit = await this.get(unit.source_unit, { missing: true });
    if (!unit || unit.source_unit !== unit.url || !unit.translation?.startsWith(`${this.config.base}/api/translations/${this.config.project}/`) ||
        !new URL(unit.translation).pathname.endsWith('/en/')) return null;
    const link = new URL(unit.web_url);
    if (link.origin !== new URL(this.config.base).origin || !link.pathname.startsWith(`/translate/${this.config.project}/`)) {
      throw new NotificationError('Weblate returned an unexpected source link.');
    }
    if (!Array.isArray(unit.source) || unit.source.every(value => !value)) return null;
    let component = new URL(entry.component).pathname.split(`/components/${this.config.project}/`)[1].replace(/\/$/, '');
    component = decodeURIComponent(decodeURIComponent(component));
    return { id: unit.id, unit: unit.url, key: unit.context, source: unit.source, url: unit.web_url,
      component, added: entry.added, force: entry.force, old: entry.old, oldContext: entry.oldContext };
  }
}

module.exports = { settings, candidate, Weblate, NotificationError, ACTIONS };

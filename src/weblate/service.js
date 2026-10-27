const crypto = require('node:crypto');
const { ChannelType, PermissionFlagsBits, Routes } = require('discord.js');
const { candidate, Weblate, NotificationError } = require('./client');
const { Store } = require('./store');
const { signature, messages, sameMessage } = require('./messages');

const LOOKBACK = 15 * 60 * 1000;

class TranslatorNotices {
  constructor(client, config, { api, store, clock = Date.now, quietMs = 60000, pollMs = 15000 } = {}) {
    this.client = client;
    this.config = config;
    this.api = api || new Weblate(config);
    this.store = store || new Store(config.statePath, {
      base: config.base, project: config.project, guild: config.guildId, thread: config.threadId,
    });
    this.clock = clock;
    this.quietMs = quietMs;
    this.pollMs = pollMs;
    this.running = false;
    this.timer = null;
    this.inflight = null;
  }

  async destination(posting = true) {
    const thread = await this.client.channels.fetch(this.config.threadId);
    const isThread = thread?.isThread();
    if (!thread || (!isThread && ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(thread.type)) ||
        thread.guildId !== this.config.guildId) {
      throw new NotificationError('The configured translator destination is unavailable, not a text channel/thread, or belongs to a different server.');
    }
    await thread.guild.members.fetchMe();
    if (isThread) await thread.guild.channels.fetch(thread.parentId);
    const required = [PermissionFlagsBits.ViewChannel, isThread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
    if (!thread.permissionsFor(this.client.user)?.has(required)) {
      throw new NotificationError('Mr. Redux needs view, posting, embed and message history permissions in the translator destination.');
    }
    if (isThread && thread.locked) throw new NotificationError('The translator thread is locked. Pending notices are retained.');
    if (isThread && thread.archived && posting) await thread.setArchived(false);
    return thread;
  }

  async poll() {
    const now = this.clock();
    const next = structuredClone(this.store.data);
    if (next.baselineId === null) {
      const latest = await this.api.latest();
      if (!Number.isSafeInteger(latest.id)) throw new NotificationError('Weblate returned an invalid initial changes cursor.');
      next.baselineId = latest.id;
      next.cursorAt = new Date(now).toISOString();
      next.lastPoll = now;
      this.store.save(next);
      return;
    }
    const from = new Date(Date.parse(next.cursorAt) - LOOKBACK).toISOString();
    const until = new Date(now).toISOString();
    const changes = await this.api.changes(from, until);
    for (const change of changes) {
      if (!Number.isSafeInteger(change.id) || !Number.isFinite(Date.parse(change.timestamp))) {
        throw new NotificationError('Weblate returned an invalid change; the changes cursor was not advanced.');
      }
      if (change.id <= next.baselineId || next.seen[change.id]) continue;
      next.seen[change.id] = change.timestamp;
      const event = candidate(change, this.config);
      if (!event) continue;
      const key = event.component + ':' + (event.context || event.unit);
      const previous = next.pending[key];
      next.pending[key] = previous ? {
        ...event, old: previous.old, oldContext: previous.oldContext,
        added: previous.added || event.added, force: previous.force || event.force,
      } : event;
      next.quietUntil = now + this.quietMs;
    }
    for (const [id, stamp] of Object.entries(next.seen)) {
      if (Date.parse(stamp) < Date.parse(from)) delete next.seen[id];
    }
    next.cursorAt = until;
    next.lastPoll = now;
    this.store.save(next);
  }

  freeze() {
    const state = this.store.data;
    if (state.outbox || !Object.keys(state.pending).length || this.clock() < state.quietUntil) return;
    const entries = Object.values(state.pending);
    const id = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
    state.outbox = { id, entries, parts: null, units: null, nextPart: 0, attemptedAt: null, sent: [] };
    state.pending = {};
    state.quietUntil = 0;
    this.store.save();
  }

  async prepare() {
    const box = this.store.data.outbox;
    if (!box || box.parts !== null) return;
    const unique = new Map();
    for (const entry of box.entries) {
      const unit = await this.api.source(entry);
      if (!unit) continue;
      if (!unit.added && !unit.force && unit.source.length === 1 && unit.old === unit.source[0] && unit.oldContext === unit.key) continue;
      if (this.store.data.delivered[unit.unit] === signature(unit)) continue;
      const previous = unique.get(unit.unit);
      unique.set(unit.unit, previous ? { ...unit, added: previous.added || unit.added } : unit);
    }
    box.units = [...unique.values()];
    const timestamp = box.entries.reduce((latest, item) => Math.max(latest, Date.parse(item.timestamp)), 0);
    box.parts = messages(box.units, timestamp, `${this.config.base}/projects/${this.config.project}/`);
    this.store.save();
  }

  async recover(payload, attemptedAt) {
    let before;
    while (true) {
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const rows = await this.client.rest.get(Routes.channelMessages(this.config.threadId), { query });
      if (!rows.length) return null;
      const match = rows.find(message => sameMessage(message, payload, this.client.user.id));
      if (match) return match.id;
      const last = rows[rows.length - 1];
      if (Date.parse(last.timestamp) < attemptedAt - 5000 || rows.length < 100) return null;
      if (last.id === before) throw new NotificationError('Discord returned invalid history pagination.');
      before = last.id;
    }
  }

  async deliver() {
    const box = this.store.data.outbox;
    if (!box) return;
    await this.prepare();
    if (box.parts.length) await this.destination();
    while (box.nextPart < box.parts.length) {
      const payload = box.parts[box.nextPart];
      let messageId = box.attemptedAt ? await this.recover(payload, box.attemptedAt) : null;
      if (!messageId) {
        box.attemptedAt = this.clock();
        this.store.save();
        const nonce = crypto.createHash('sha256').update(`${box.id}:${box.nextPart}`).digest('hex').slice(0, 24);
        const sent = await this.client.rest.post(Routes.channelMessages(this.config.threadId), {
          body: { ...payload, nonce, enforce_nonce: true },
        });
        messageId = sent.id;
      }
      box.sent.push(messageId);
      box.nextPart += 1;
      box.attemptedAt = null;
      this.store.save();
    }
    for (const unit of box.units) this.store.data.delivered[unit.unit] = signature(unit);
    this.store.data.outbox = null;
    this.store.save();
  }

  async tick() {
    // A failed/partial API scan never advances the cursor or releases a batch.
    await this.poll();
    this.freeze();
    await this.deliver();
    this.store.data.lastSuccess = this.clock();
    this.store.save();
  }

  async start() {
    this.running = true;
    let checked = false;
    const run = () => {
      this.inflight = (async () => {
        if (!checked) {
          await this.destination(false);
          checked = true;
        }
        await this.tick();
      })().catch(error => {
        console.error('[weblate]', error instanceof NotificationError ? error.message : 'A notification operation failed; pending notices are retained for retry.');
      }).finally(() => {
        if (this.running) this.timer = setTimeout(run, this.pollMs);
      });
      return this.inflight;
    };
    await run();
    console.log('[weblate] Translator notice worker started with a 60-second quiet window.');
  }

  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.inflight) await this.inflight;
  }
}

module.exports = { TranslatorNotices };

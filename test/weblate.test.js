const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/weblate/store');
const { TranslatorNotices } = require('../src/weblate/service');
const { candidate, Weblate, NotificationError } = require('../src/weblate/client');
const { messages } = require('../src/weblate/messages');

const BASE = 'https://translate.ksp2redux.org';
const CONFIG = { base: BASE, project: 'ksp2redux', guildId: '1078696971088433153', threadId: '1500585253146857522', token: 'test-only' };

function change(id, key = 'Testing/Key', action = 31, language = 'en', old = 'Source A', target = 'Source B') {
  return { id, action, unit: `${BASE}/api/units/1/`, component: `${BASE}/api/components/ksp2redux/ui%252Fsettings/`,
    translation: `${BASE}/api/translations/ksp2redux/ui%252Fsettings/${language}/`,
    timestamp: new Date(Date.UTC(2026, 9, 27, 12, 0, 0, id - 100)).toISOString(),
    old, target, details: { context: key, source: target } };
}

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'redux-weblate-test-'));
  t.after(() => {
    assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(folder).startsWith('redux-weblate-test-'));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  let now = Date.UTC(2026, 9, 27, 12);
  const clock = () => now;
  const file = path.join(folder, 'state.json');
  const binding = { base: BASE, project: CONFIG.project, guild: CONFIG.guildId, thread: CONFIG.threadId };
  const posts = [], history = [], events = [];
  const source = { id: 1, unit: `${BASE}/api/units/1/`, key: 'Testing/Key', source: ['Source B'],
    url: `${BASE}/translate/ksp2redux/ui/settings/en/?checksum=abc`, component: 'ui/settings' };
  const api = {
    latest: async () => ({ id: 100, timestamp: new Date(now).toISOString() }),
    changes: async () => [...events],
    source: async event => ({ ...source, added: event.added, force: event.force, old: event.old, oldContext: event.oldContext }),
  };
  const client = { user: { id: '1496359877193371859' }, rest: {
    post: async (route, options) => {
      posts.push(options.body);
      const message = { ...options.body, id: String(1000 + posts.length), author: client.user, timestamp: new Date(now).toISOString() };
      history.unshift(message);
      return message;
    },
    get: async () => history,
  } };
  const make = () => {
    const service = new TranslatorNotices(client, CONFIG, { api, clock, store: new Store(file, binding) });
    service.destination = async () => ({});
    return service;
  };
  return { make, api, client, posts, history, events, source, file, binding, advance: ms => { now += ms; } };
}

test('English source events are distinguished from translation and status changes', () => {
  assert.ok(candidate(change(101), CONFIG));
  assert.ok(candidate(change(102, 'Key', 2), CONFIG));
  assert.equal(candidate(change(103, 'Key', 2, 'ja'), CONFIG), null);
  assert.equal(candidate(change(104, 'Key', 86), CONFIG), null);
  assert.equal(candidate(change(105, 'Key', 2, 'en', 'Same', 'Same'), CONFIG), null);
  assert.ok(candidate(change(106, 'Key', 30, 'de'), CONFIG));
  assert.equal(candidate({ ...change(107), component: `${BASE}/api/components/other/ui/` }, CONFIG), null);
});

test('a rolling minute coalesces source edits without being reset by duplicate polls', async t => {
  const f = fixture(t), service = f.make();
  await service.tick(); // Establish the baseline without announcing history.
  f.events.push(change(101));
  await service.tick();
  f.advance(30000);
  f.events.push(change(102, 'Testing/Key', 2));
  await service.tick();
  f.advance(40000);
  await service.tick();
  assert.equal(f.posts.length, 0);
  f.advance(20000);
  await service.tick();
  assert.equal(f.posts.length, 1);
  assert.match(f.posts[0].content, /1 added · 0 updated/);
  assert.match(f.posts[0].embeds[0].description, /Testing\/Key/);
  assert.match(f.posts[0].embeds[0].description, /checksum=abc/);
  assert.deepEqual(f.posts[0].allowed_mentions, { parse: [] });
  assert.equal(f.posts[0].enforce_nonce, true);
  assert.equal(service.store.data.outbox, null);
});

test('translation-only work does not extend an English source batch', async t => {
  const f = fixture(t), service = f.make();
  await service.tick();
  f.events.push(change(101)); await service.tick();
  f.advance(50000); f.events.push(change(102, 'Testing/Key', 2, 'de')); await service.tick();
  f.advance(10000); await service.tick();
  assert.equal(f.posts.length, 1);
});

test('pending batches and delivery deduplication survive a process restart', async t => {
  const f = fixture(t);
  let service = f.make();
  await service.tick();
  f.events.push(change(101)); await service.tick();
  f.advance(60000);
  service = f.make();
  await service.tick();
  assert.equal(f.posts.length, 1);
  service = f.make();
  f.events.push(change(102)); await service.tick();
  f.advance(60000); await service.tick();
  assert.equal(f.posts.length, 1);
});

test('failed feed reads do not advance the cursor or release an incomplete batch', async t => {
  const f = fixture(t), service = f.make();
  await service.tick();
  f.events.push(change(101)); await service.tick();
  const cursor = service.store.data.cursorAt;
  f.advance(60000);
  const original = f.api.changes;
  f.api.changes = async () => { throw new NotificationError('temporarily unavailable'); };
  await assert.rejects(service.tick(), /temporarily unavailable/);
  assert.equal(service.store.data.cursorAt, cursor);
  assert.equal(f.posts.length, 0);
  f.api.changes = original;
  await service.tick();
  assert.equal(f.posts.length, 1);
});

test('an ambiguous Discord send is recovered from history rather than posted twice', async t => {
  const f = fixture(t);
  let service = f.make();
  await service.tick(); f.events.push(change(101)); await service.tick(); f.advance(60000);
  const original = f.client.rest.post;
  f.client.rest.post = async (...args) => { await original(...args); throw new Error('connection lost after send'); };
  await assert.rejects(service.tick(), /connection lost/);
  assert.equal(f.posts.length, 1);
  service = f.make();
  f.client.rest.post = original;
  await service.tick();
  assert.equal(f.posts.length, 1);
  assert.equal(service.store.data.outbox, null);
});

test('a deleted source and a net-reverted English edit need no translation notice', async t => {
  const f = fixture(t), service = f.make();
  await service.tick();
  f.events.push(change(101, 'Testing/Key', 2, 'en', 'Source A', 'Source B'));
  await service.tick();
  f.source.source = ['Source A'];
  f.advance(60000); await service.tick();
  assert.equal(f.posts.length, 0);
  f.events.push(change(102)); await service.tick();
  f.api.source = async () => null;
  f.advance(60000); await service.tick();
  assert.equal(f.posts.length, 0);
  assert.equal(service.store.data.outbox, null);
});

test('large batches contain every complete key and direct link in numbered parts', () => {
  const units = Array.from({ length: 180 }, (_, i) => ({ added: i % 2 === 0, component: 'ui/settings',
    key: `Testing/FullKey_${i}`, source: ['Source'], url: `${BASE}/translate/ksp2redux/ui/settings/en/?checksum=${i}` }));
  const parts = messages(units, Date.UTC(2026, 9, 27), `${BASE}/projects/ksp2redux/`);
  assert.ok(parts.length > 1 && parts.length < units.length);
  const text = parts.flatMap(p => p.embeds.map(e => e.description)).join('\n');
  for (const unit of units) {
    assert.ok(text.includes(unit.url));
    assert.ok(text.includes(unit.key.replace('_', '\\_')));
  }
  for (const [index, part] of parts.entries()) {
    assert.ok(part.embeds[0].description.length <= 3800);
    assert.match(part.embeds[0].title, new RegExp(`${index + 1}/${parts.length}`));
  }
});

test('corrupt state and a different destination never silently reset pending notices', t => {
  const f = fixture(t), service = f.make();
  service.store.save();
  assert.throws(() => new Store(f.file, { ...f.binding, thread: 'another' }), /refusing to discard/);
  fs.writeFileSync(f.file, '{incomplete');
  assert.throws(() => f.make(), /refusing to discard/);
});

test('API credentials never follow external URLs or redirects', async () => {
  let calls = 0;
  const api = new Weblate(CONFIG, async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    assert.equal(url.origin, BASE);
    return { ok: true, json: async () => ({ results: [], next: 'https://example.org/steal' }) };
  });
  await assert.rejects(api.get('https://example.org/steal'), /unexpected API address/);
  assert.equal(calls, 0);
  await assert.rejects(api.changes('2026-10-27T00:00:00Z', '2026-10-27T01:00:00Z'), /invalid changes pagination/);
  assert.equal(calls, 1);
});

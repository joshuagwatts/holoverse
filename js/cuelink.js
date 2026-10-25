/* HOLOVERSE build 5a — Cue Room link client.
 *
 * A faithful port of Cue Room's wire protocol (~/workspace/cue-room —
 * js/relay.js transport + js/app.js session machine) so a holoverse
 * client can join a Cue Room as a full citizen: same kind-20001
 * ephemeral Nostr events on the same 3 pinned relays, same tag
 * ('cueroom_by_holowatts:<CODE>'), same message shapes, same rules —
 * lowest-cid holder election with a 2.5s handoff collection, rev-
 * guarded holder syncs, pending-ack add retries, 2-vote skips with
 * holder confirm + voter fallback, build-4 bad/ended corroboration,
 * and sender-clock skew correction. Anything less than faithful would
 * make the in-world client a second-class listener that can wedge or
 * fork the room; this client can hold the line itself.
 *
 * All playback/DOM concerns live behind hooks supplied by game.js:
 *   onPlay(play)   — adopt this play payload (start/restart playback)
 *   onStop()       — the room stopped; silence local playback
 *   onQueue()      — queue/roster/holder changed; re-render from state
 *   onFeed(text)   — a room line worth showing the user
 *   onConn(n)      — live relay socket count changed
 *   playerPos()    — my player's position (s) or null (bad-report math)
 *   playerDur()    — my player's duration (s) or null (end window)
 *   selfHeal()     — restart my player at the room position (my copy
 *                    of the track is broken; the room is fine)
 */

const CUE_RELAYS = [
  'wss://yabu.me/v2',
  'wss://relay02.lnfi.network',
  'wss://relay.sigit.io',
];
const CUE_KIND = 20001;
const CUE_MAX_BYTES = 48 * 1024;
const CUE_TOOLS_URL = 'https://esm.sh/nostr-tools@2.10.4';
export const CUE_APP_TAG = 'cueroom_by_holowatts';
export const CUE_PROVIDERS = ['youtube', 'youtube-playlist', 'soundcloud', 'soundcloud-set',
  'soundcloud-short', 'direct-audio', 'bandcamp', 'drive', 'external'];
export const CUE_MAX_QUEUE = 50;
const HELLO_MS = 8000, ROSTER_TTL_MS = 25000, SYNC_MS = 10000, HANDOFF_MS = 2500;
const ACK_MS = 20000, ACK_RETRIES = 8;

/* ---- validation, ported 1:1 from cue-room providers.js ---- */
export function cueValidAdd(d) {
  if (!d || typeof d !== 'object') return false;
  if (typeof d.id !== 'string' || !d.id || d.id.length > 48) return false;
  if (!CUE_PROVIDERS.includes(d.provider)) return false;
  if (typeof d.url !== 'string' || !d.url || d.url.length > 600) return false;
  if (d.provider === 'drive' && (typeof d.driveId !== 'string' || !/^[A-Za-z0-9_-]{10,64}$/.test(d.driveId))) return false;
  if (d.provider === 'bandcamp' && (typeof d.streamUrl !== 'string' || !d.streamUrl || d.streamUrl.length > 1400)) return false;
  if (typeof d.title !== 'string' || !d.title || d.title.length > 160) return false;
  if (typeof d.addedBy !== 'string' || !d.addedBy || d.addedBy.length > 24) return false;
  if (typeof d.addedById !== 'string' || !d.addedById) return false;
  if (typeof d.addedAt !== 'number') return false;
  if (d.videoId != null && (typeof d.videoId !== 'string' || d.videoId.length > 24)) return false;
  if (d.durationMs != null && typeof d.durationMs !== 'number') return false;
  return true;
}
export function cueValidPlay(d) {
  if (!d || typeof d !== 'object') return false;
  if (d.stopped) return typeof d.by === 'string';
  if (!cueValidAdd(d)) return false;
  if (typeof d.startedAt !== 'number' || typeof d.by !== 'string') return false;
  return true;
}
export function cueMakeId() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}
export function cueCleanRoomCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{4,10}$/.test(s) ? s : null;
}

/* ---- transport, ported from cue-room relay.js (class renamed) ---- */
class CueRelay {
  constructor(tag, onMessage, onStatus) {
    this.tag = tag;
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.tools = null;
    this.seckey = null;
    this.sockets = new Map();
    this.allSockets = new Map();
    this.ready = false;
    this.closed = false;
    this.outbox = [];
    this.seen = new Map();
    this.tx = 0; this.rx = 0;
    this.backoff = new Map();
  }

  async start() {
    let tools = null;
    try { tools = await import(/* @vite-ignore */CUE_TOOLS_URL); } catch (e) { tools = null; }
    if (!tools || typeof tools.finalizeEvent !== 'function' ||
        typeof tools.generateSecretKey !== 'function') {
      this.onStatus({ sockets: 0, ready: false, error: 'relay library failed to load' });
      return false;
    }
    try {
      this.seckey = tools.generateSecretKey();
      tools.getPublicKey(this.seckey);
    } catch (e) {
      this.onStatus({ sockets: 0, ready: false, error: 'relay keygen failed' });
      return false;
    }
    this.tools = tools;
    this.ready = true;
    for (const url of CUE_RELAYS) this._connect(url);
    this.onStatus({ sockets: 0, ready: true });
    return true;
  }

  close() {
    this.closed = true; this.ready = false;
    for (const ws of this.allSockets.values()) { try { ws.close(); } catch (e) {} }
    this.allSockets.clear(); this.sockets.clear();
  }

  _status() { this.onStatus({ sockets: this.sockets.size, ready: this.ready }); }

  _connect(url) {
    if (this.closed || !this.ready || this.allSockets.has(url)) return;
    let ws = null;
    try { ws = new WebSocket(url); } catch (e) { return; }
    this.allSockets.set(url, ws);
    ws.addEventListener('open', () => {
      if (this.allSockets.get(url) !== ws) return;
      this.backoff.delete(url);
      this.sockets.set(url, ws);
      this._sendReq(ws);
      this._flushOutbox();
      this._status();
    });
    ws.addEventListener('message', (ev) => { try { this._onMessage(String(ev.data)); } catch (e) {} });
    const drop = () => {
      if (this.allSockets.get(url) === ws) this.allSockets.delete(url);
      if (this.sockets.get(url) === ws) this.sockets.delete(url);
      this._status();
      if (!this.closed && this.ready) {
        const fails = (this.backoff.get(url) || 0) + 1;
        this.backoff.set(url, fails);
        const delay = Math.min(60000, 4000 * Math.pow(2, Math.min(fails - 1, 4)));
        setTimeout(() => this._connect(url), delay);
      }
    };
    ws.addEventListener('close', drop);
    ws.addEventListener('error', () => { try { ws.close(); } catch (e) {} });
  }

  _subId() { return 'cue-' + this.tag.replace(/[^A-Za-z0-9]/g, '').slice(-24); }

  _sendReq(ws) {
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify(['REQ', this._subId(), {
        kinds: [CUE_KIND], '#t': [this.tag],
        since: Math.floor(Date.now() / 1000) - 5, limit: 50,
      }]));
    } catch (e) {}
  }

  _onMessage(data) {
    if (!data || data.charCodeAt(0) !== 91) return;
    let arr = null;
    try { arr = JSON.parse(data); } catch (e) { return; }
    if (!Array.isArray(arr) || arr[0] !== 'EVENT') return;
    const ev = arr[2];
    if (!ev || ev.kind !== CUE_KIND || !Array.isArray(ev.tags)) return;
    let tag = null;
    for (const t of ev.tags) if (Array.isArray(t) && t[0] === 't') { tag = t[1]; break; }
    if (tag !== this.tag) return;
    let obj = null;
    try { obj = JSON.parse(ev.content); } catch (e) { return; }
    if (!obj || typeof obj !== 'object' || typeof obj.mid !== 'string') return;
    const now = Date.now();
    if (this.seen.has(obj.mid)) return;
    this.seen.set(obj.mid, now);
    if (this.seen.size > 600) {
      for (const [k, at] of this.seen) { if (now - at > 300000) this.seen.delete(k); }
      while (this.seen.size > 600) this.seen.delete(this.seen.keys().next().value);
    }
    this.rx++;
    try { this.onMessage(obj); } catch (e) {}
  }

  publish(obj) {
    if (!this.ready || !this.tools || !this.seckey || this.closed) return false;
    if (!obj.mid) obj.mid = obj.cid + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
    this.seen.set(obj.mid, Date.now());
    let content = null;
    try { content = JSON.stringify(obj); } catch (e) { return false; }
    if (content.length > CUE_MAX_BYTES) return false;
    let ev = null;
    try {
      ev = this.tools.finalizeEvent({ kind: CUE_KIND, tags: [['t', this.tag]], content, created_at: Math.floor(Date.now() / 1000) }, this.seckey);
    } catch (e) { return false; }
    const msg = JSON.stringify(['EVENT', ev]);
    let sent = 0;
    for (const ws of this.sockets.values()) {
      try { if (ws.readyState === 1) { ws.send(msg); sent++; } } catch (e) {}
    }
    if (sent > 0) { this.tx++; return true; }
    if (this.outbox.length < 40) this.outbox.push(obj);
    return false;
  }

  _flushOutbox() {
    if (!this.outbox.length) return;
    const pending = this.outbox; this.outbox = [];
    for (const obj of pending) this.publish(obj);
  }
}

/* ---- the session machine, ported from cue-room app.js ---- */
export class CueClient {
  constructor(opts) {
    this.name = String(opts.name || 'drifter').slice(0, 16) || 'drifter';
    this.cid = opts.cid;
    this.hooks = opts.hooks || {};
    this.room = null;
    this.relay = null;
    this.sockets = 0;
    this.queue = [];
    this.now = null;
    this.nowStartedAt = 0;
    this.adoptedAt = 0;
    this.roster = new Map();
    this.iAmHolder = false;
    this.holderCid = null;
    this.holderName = '';
    this.syncRev = 0;
    this.syncRevSeen = -1;
    this.syncTimer = null;
    this.helloTimer = null;
    this.tickTimer = null;
    this.holderCatchingUp = false;
    this.handoffTimer = null;
    this.handoffAnswers = [];
    this.lastKnown = null;
    this.pendingAck = new Map();
    this.removedIds = new Map();
    this.skipVotes = new Map();
    this.skipConfirmTimer = null;
    this.errAdvancedFor = null;
    this.endedNotifiedFor = null;
    this.badReportedFor = null;
    this.selfHealFor = null;
    this.nowOriginCid = null;
    this.badReports = new Map();
    this.badPosAtReport = null;
    this.skewSamples = [];
    this.closed = false;
  }

  /* ---------- lifecycle ---------- */

  async start(code) {
    this.room = code;
    this.relay = new CueRelay(CUE_APP_TAG + ':' + code,
      (obj) => this.handleMessage(obj),
      (st) => {
        this.sockets = st.sockets;
        if (this.hooks.onConn) this.hooks.onConn(st.sockets, st);
      });
    const ok = await this.relay.start();
    this.startHellos();
    this.tickTimer = setInterval(() => this.tick(), 1000);
    // Ask the room for the line right away (mirrors the app).
    setTimeout(() => this.send({ t: 'stateReq', reqId: cueMakeId() }), 1200);
    setTimeout(() => { if (!this.now && !this.queue.length) this.send({ t: 'stateReq', reqId: cueMakeId() }); }, 6000);
    return ok;
  }

  close() {
    this.closed = true;
    try { this.send({ t: 'bye' }); } catch (e) {}
    if (this.helloTimer) clearInterval(this.helloTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.handoffTimer) clearTimeout(this.handoffTimer);
    if (this.skipConfirmTimer) clearTimeout(this.skipConfirmTimer);
    if (this.relay) this.relay.close();
    this.relay = null;
  }

  send(obj) {
    if (!this.relay) return false;
    return this.relay.publish({ cid: this.cid, name: this.name, at: Date.now(), ...obj });
  }

  feed(text) { if (this.hooks.onFeed) this.hooks.onFeed(text); }
  changed() { if (this.hooks.onQueue) this.hooks.onQueue(); }

  /* ---------- clock skew (cue build 4) ---------- */

  noteSkew(senderAt) {
    if (!senderAt || !Number.isFinite(senderAt)) return;
    this.skewSamples.push(senderAt - Date.now());
    if (this.skewSamples.length > 6) this.skewSamples.shift();
  }
  resetSkew(senderAt) { this.skewSamples = []; this.noteSkew(senderAt); }
  clockSkew() { return this.skewSamples.length ? Math.max(...this.skewSamples) : 0; }
  correctedNow() { return Date.now() + this.clockSkew(); }
  offsetFor(now) {
    const n = this.correctedNow();
    return Math.max(0, (n - (now ? now.startedAt : n)) / 1000);
  }

  /* ---------- roster + election ---------- */

  notePeer(cid, name) {
    if (!cid || cid === this.cid) return;
    const isNew = !this.roster.has(cid);
    this.roster.set(cid, { name: String(name || 'guest').slice(0, 24), lastSeen: Date.now() });
    this.recomputeHolder();
    if (isNew) {
      this.feed((name || 'Someone') + ' joined the cue room');
      this.send({ t: 'hello' });
      if (this.iAmHolder) this.broadcastSync();
    }
    this.changed();
  }

  recomputeHolder() {
    const now = Date.now();
    for (const [cid, rec] of this.roster) if (now - rec.lastSeen > ROSTER_TTL_MS) this.roster.delete(cid);
    let lowest = this.cid, lowestCid = this.cid;
    for (const cid of this.roster.keys()) if (cid < lowest) { lowest = cid; lowestCid = cid; }
    const prev = this.holderCid;
    this.holderCid = lowestCid;
    if (lowestCid === this.cid) {
      if (!this.iAmHolder) this.becomeHolder();
      this.holderName = this.name;
    } else {
      if (this.iAmHolder) this.stepDown();
      const rec = this.roster.get(lowestCid);
      this.holderName = rec ? rec.name : 'a friend';
    }
    if (prev !== this.holderCid) { this.syncRevSeen = -1; this.changed(); }
  }

  becomeHolder() {
    this.iAmHolder = true;
    this.pendingAck.clear();
    this.send({ t: 'claim' });
    this.holderCatchingUp = true;
    this.handoffAnswers = [];
    this.send({ t: 'stateReq', reqId: 'handoff' });
    if (this.handoffTimer) clearTimeout(this.handoffTimer);
    this.handoffTimer = setTimeout(() => this.finishHandoff(), HANDOFF_MS);
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => { if (this.iAmHolder && !this.holderCatchingUp) this.broadcastSync(); }, SYNC_MS);
    this.changed();
  }

  finishHandoff() {
    if (this.handoffTimer) { clearTimeout(this.handoffTimer); this.handoffTimer = null; }
    if (!this.iAmHolder) { this.holderCatchingUp = false; return; }
    this.holderCatchingUp = false;
    let best = null;
    const consider = (queue, now, at) => {
      // Build 4 scoring: a now-playing beats a bare queue; between two
      // now-playings the LATER startedAt is the room's present.
      const score = (now ? 1e13 + (now.startedAt || 0) : 0) + (Array.isArray(queue) ? queue.length : 0);
      if (!best || score > best.score || (score === best.score && (at || 0) > (best.at || 0))) {
        best = { queue: queue || [], now: now || null, at: at || 0, score };
      }
    };
    for (const a of this.handoffAnswers) consider(a.queue, a.now, a.at);
    if (this.lastKnown) consider(this.lastKnown.queue, this.lastKnown.now, this.lastKnown.at);
    consider(this.queue, this.now, Date.now());
    if (best) {
      const bn = best.now;
      this.queue = (Array.isArray(best.queue) ? best.queue : []).filter(cueValidAdd)
        .filter((t) => !(bn && t.id === bn.id)).slice(0, CUE_MAX_QUEUE);
      this.sortQueue();
      if (bn && cueValidPlay(bn) && !bn.stopped && (!this.now || this.now.id !== bn.id)) this.adoptPlay(bn);
      else if (!this.now && this.queue.length) this.advance();
    }
    this.broadcastSync();
    this.changed();
  }

  stepDown() {
    this.iAmHolder = false;
    this.holderCatchingUp = false;
    if (this.handoffTimer) { clearTimeout(this.handoffTimer); this.handoffTimer = null; }
    if (this.syncTimer) { clearInterval(this.syncTimer); this.syncTimer = null; }
    this.changed();
  }

  startHellos() {
    const tickHello = () => { this.send({ t: 'hello' }); this.recomputeHolder(); };
    tickHello();
    if (this.helloTimer) clearInterval(this.helloTimer);
    this.helloTimer = setInterval(tickHello, HELLO_MS);
  }

  /* ---------- sync / state ---------- */

  broadcastSync() {
    if (!this.iAmHolder || this.holderCatchingUp) return;
    this.syncRev++;
    this.send({ t: 'sync', rev: this.syncRev, at: Date.now(), queue: this.queue.slice(0, CUE_MAX_QUEUE), now: this.now });
  }

  handleSync(obj) {
    this.notePeer(obj.cid, obj.name);
    if (obj.cid !== this.holderCid) return;
    if (typeof obj.rev !== 'number' || obj.rev <= this.syncRevSeen) return;
    this.syncRevSeen = obj.rev;
    const incoming = (Array.isArray(obj.queue) ? obj.queue : []).filter(cueValidAdd)
      .filter((t) => !this.removedIds.has(t.id));
    const incomingIds = new Set(incoming.map((t) => t.id));
    if (obj.now && cueValidPlay(obj.now) && !obj.now.stopped) incomingIds.add(obj.now.id);
    for (const id of [...this.pendingAck.keys()]) if (incomingIds.has(id)) this.pendingAck.delete(id);
    const unconfirmed = this.queue.filter((t) => t.addedById === this.cid && this.pendingAck.has(t.id) && !incomingIds.has(t.id));
    this.queue = incoming.concat(unconfirmed).slice(0, CUE_MAX_QUEUE);
    this.sortQueue();
    const dn = obj.now;
    if (incoming.length || (dn && cueValidPlay(dn) && !dn.stopped)) {
      this.lastKnown = { queue: incoming.slice(0, CUE_MAX_QUEUE), now: (dn && cueValidPlay(dn) && !dn.stopped) ? dn : null, at: obj.at || Date.now() };
    }
    if (dn && cueValidPlay(dn) && !dn.stopped) {
      if (!this.now || this.now.id !== dn.id) { this.resetSkew(obj.at); this.adoptPlay(dn, obj.cid); }
      else if (obj.cid === this.nowOriginCid) this.noteSkew(obj.at);
    } else if (dn && dn.stopped && this.now && (dn.startedAt || 0) >= this.nowStartedAt) {
      this.stopPlayback();
    }
    this.changed();
  }

  handleStateReq(obj) {
    if (obj.reqId === 'handoff' || this.iAmHolder) {
      const shareNow = this.now && cueValidPlay(this.now) ? this.now : null;
      this.send({ t: 'state', reqId: obj.reqId, at: Date.now(), queue: this.queue.slice(0, CUE_MAX_QUEUE), now: shareNow });
    }
  }

  handleState(obj) {
    this.notePeer(obj.cid, obj.name);
    if (this.holderCatchingUp) { this.handoffAnswers.push(obj); return; }
    if (this.iAmHolder) return;
    if (obj.cid !== this.holderCid && this.holderCid) {
      if (this.now || this.queue.length) return;
    }
    const q = (Array.isArray(obj.queue) ? obj.queue : []).filter(cueValidAdd);
    if (obj.now && cueValidPlay(obj.now) && !obj.now.stopped) {
      if (!this.now || this.now.id !== obj.now.id) { this.resetSkew(obj.at); this.adoptPlay(obj.now, obj.cid); }
      else if (obj.cid === this.nowOriginCid) this.noteSkew(obj.at);
    }
    if (q.length && !this.queue.length) { this.queue = q; this.sortQueue(); }
    this.lastKnown = { queue: q, now: obj.now || null, at: obj.at || Date.now() };
    this.changed();
  }

  /* ---------- queue ops ---------- */

  sortQueue() {
    this.queue.sort((a, b) => (a.addedAt - b.addedAt) || (a.id < b.id ? -1 : 1));
  }

  trackPending(t) {
    if (this.iAmHolder) return;
    this.pendingAck.set(t.id, { track: t, sentAt: Date.now(), retries: 0 });
  }

  /* A track cued from THIS client (already a valid cue track). */
  localAdd(t) {
    if (!cueValidAdd(t)) return null;
    if (this.queue.some((x) => x.id === t.id) || (this.now && this.now.id === t.id)) return null;
    if (this.queue.length >= CUE_MAX_QUEUE) { this.feed('The cue queue is full at ' + CUE_MAX_QUEUE); return null; }
    this.queue.push(t);
    this.sortQueue();
    this.send({ t: 'add', track: t });
    this.trackPending(t);
    this.changed();
    if (!this.now) this.advance();
    return t;
  }

  handleAdd(obj) {
    this.notePeer(obj.cid, obj.name);
    const t = obj.track;
    if (!cueValidAdd(t)) return;
    if (this.removedIds.has(t.id)) return;
    const existed = this.queue.some((x) => x.id === t.id) || (this.now && this.now.id === t.id);
    if (!existed) {
      this.queue.push(t); this.sortQueue();
      this.feed(t.addedBy + ' cued “' + t.title + '”');
    }
    if (this.iAmHolder) this.broadcastSync();
    this.changed();
    if (!this.now) this.advance();
  }

  handleRemove(obj) {
    const i = this.queue.findIndex((t) => t.id === obj.id);
    if (i === -1) return;
    const t = this.queue[i];
    if (t.addedById !== obj.cid && obj.cid !== this.holderCid) return;
    this.queue.splice(i, 1);
    this.removedIds.set(obj.id, Date.now());
    this.pendingAck.delete(obj.id);
    this.feed(t.addedBy + '’s track was pulled from the queue');
    if (this.iAmHolder) this.broadcastSync();
    this.changed();
  }

  /* Pull one of MY OWN queued tracks (the in-world ✕ on my items). */
  localRemove(id) {
    const i = this.queue.findIndex((t) => t.id === id);
    if (i === -1) return;
    this.queue.splice(i, 1);
    this.removedIds.set(id, Date.now());
    this.pendingAck.delete(id);
    this.send({ t: 'remove', id });
    if (this.iAmHolder) this.broadcastSync();
    this.changed();
  }

  handleTitle(obj) {
    const t = this.queue.find((x) => x.id === obj.id);
    if (t && typeof obj.title === 'string') t.title = obj.title.slice(0, 160);
    if (this.now && this.now.id === obj.id && typeof obj.title === 'string') this.now.title = obj.title.slice(0, 160);
    if (this.iAmHolder) this.broadcastSync();
    this.changed();
  }

  /* My copy of a track got its real title after cueing (the game
   * enriches titles locally) — share it like the app does. */
  localTitle(t) {
    if (!t || t.addedById !== this.cid) return;
    this.send({ t: 'title', id: t.id, title: String(t.title || '').slice(0, 160) });
  }

  /* ---------- playback ---------- */

  advance() {
    const next = this.queue.shift() || null;
    if (!next) {
      this.send({ t: 'play', stopped: true, by: this.name, startedAt: Date.now() });
      this.stopPlayback();
      return null;
    }
    const play = { ...next, startedAt: Date.now(), by: this.name };
    this.send({ t: 'play', track: play });
    this.resetSkew(Date.now());
    this.adoptPlay(play, this.cid);
    if (this.iAmHolder) this.broadcastSync();
    return play;
  }

  adoptPlay(play, originCid) {
    this.now = { ...play };
    this.nowStartedAt = play.startedAt;
    this.adoptedAt = Date.now();
    if (originCid) this.nowOriginCid = originCid;
    this.badReports = new Map();
    this.selfHealFor = null;
    this.skipVotes = new Map();
    this.errAdvancedFor = null; this.endedNotifiedFor = null; this.badReportedFor = null;
    const i = this.queue.findIndex((t) => t.id === play.id);
    if (i !== -1) this.queue.splice(i, 1);
    this.pendingAck.delete(play.id);
    if (this.hooks.onPlay) this.hooks.onPlay(this.now);
    this.changed();
  }

  stopPlayback() {
    this.now = null; this.nowStartedAt = 0;
    this.skipVotes = new Map();
    this.badReports = new Map();
    if (this.hooks.onStop) this.hooks.onStop();
    this.changed();
  }

  handlePlay(obj) {
    this.notePeer(obj.cid, obj.name);
    if (obj.stopped) {
      if (this.now && (obj.startedAt || 0) >= this.nowStartedAt) this.stopPlayback();
      if (this.iAmHolder) this.broadcastSync();
      return;
    }
    const d = obj.track;
    if (!cueValidPlay(d)) return;
    const inContention = Date.now() - this.adoptedAt < 1500;
    if (this.now && d.id === this.now.id && !inContention) return;
    if (inContention && this.now && d.startedAt >= this.nowStartedAt) return;
    this.resetSkew(obj.at);
    this.adoptPlay(d, obj.cid);
    if (this.iAmHolder) this.broadcastSync();
  }

  /* ---------- player events (from the game's players) ---------- */

  onPlayerEnded() {
    if (!this.now) return;
    if (this.iAmHolder) { this.advance(); return; }
    if (!this.holderCid || this.holderCid === this.cid || this.roster.size === 0) { this.advance(); return; }
    if (this.endedNotifiedFor !== this.now.id) {
      this.endedNotifiedFor = this.now.id;
      this.send({ t: 'ended', id: this.now.id });
    }
  }

  scheduleErrorAdvance(id) {
    if (this.errAdvancedFor === id) return;
    this.errAdvancedFor = id;
    setTimeout(() => {
      if (this.now && this.now.id === id && this.iAmHolder) this.advance();
    }, 2500);
  }

  handlePeerBad(obj) {
    this.notePeer(obj.cid, obj.name);
    if (!this.iAmHolder || !this.now || obj.id !== this.now.id) return;
    const id = this.now.id;
    if (!this.badReports.has(id)) {
      this.badReports.set(id, new Set());
      this.badPosAtReport = this.hooks.playerPos ? this.hooks.playerPos() : null;
    }
    this.badReports.get(id).add(obj.cid);
    setTimeout(() => {
      if (!this.now || this.now.id !== id || !this.iAmHolder) return;
      const reporters = this.badReports.has(id) ? this.badReports.get(id).size : 0;
      const pos = this.hooks.playerPos ? this.hooks.playerPos() : null;
      const mineStuck = pos == null || (this.badPosAtReport != null && Math.abs(pos - this.badPosAtReport) < 0.3);
      if (reporters >= 2 || mineStuck) this.scheduleErrorAdvance(id);
    }, 2600);
  }

  handlePeerEnded(obj) {
    this.notePeer(obj.cid, obj.name);
    if (!this.iAmHolder || !this.now || obj.id !== this.now.id) return;
    const el = this.offsetFor(this.now);
    const dur = this.now.durationMs ? this.now.durationMs / 1000 : (this.hooks.playerDur ? this.hooks.playerDur() : null);
    if (dur && dur > 0) { if (el >= dur - 15) this.advance(); }
    else if (el >= 30) this.advance();
  }

  onPlayerError(msg) {
    if (!this.now) return;
    const id = this.now.id;
    if (msg) this.feed(msg);
    if (this.iAmHolder) {
      this.roomNote('⏭ Couldn’t play “' + this.now.title.slice(0, 60) + '” — skipping', true);
      this.scheduleErrorAdvance(id);
      return;
    }
    if (this.badReportedFor !== id) {
      this.badReportedFor = id;
      this.send({ t: 'bad', id });
    }
    if (!this.holderCid || this.holderCid === this.cid) {
      setTimeout(() => {
        if (this.now && this.now.id === id && !this.iAmHolder && (!this.holderCid || this.holderCid === this.cid)) this.advance();
      }, 6000);
      return;
    }
    if (this.selfHealFor !== id) {
      this.selfHealFor = id;
      this.feed('That track won’t play on your device — the room’s still on it; resyncing you');
      setTimeout(() => {
        if (this.now && this.now.id === id && !this.iAmHolder) {
          this.send({ t: 'stateReq', reqId: cueMakeId() });
          if (this.hooks.selfHeal) this.hooks.selfHeal();
        }
      }, 1500);
    }
  }

  /* ---------- skip: 2 votes to confirm (cue rules) ---------- */

  voteSkip() {
    if (!this.now) return;
    const id = this.now.id;
    const solo = this.roster.size === 0;
    if (this.skipVotes.has(this.cid) && solo) {
      this.confirmSkip(id, [this.name, this.name]);
      return;
    }
    if (this.skipVotes.has(this.cid)) { this.feed('You already voted — needs one more person'); return; }
    this.skipVotes.set(this.cid, this.name);
    this.send({ t: 'skipVote', id, voterName: this.name });
    this.feed('You voted to skip “' + this.now.title.slice(0, 50) + '” (' + this.skipVotes.size + '/2)');
    this.changed();
    this.armSkipConfirm(id);
  }

  handleSkipVote(obj) {
    this.notePeer(obj.cid, obj.name);
    if (!this.now || obj.id !== this.now.id) return;
    if (this.skipVotes.has(obj.cid)) return;
    this.skipVotes.set(obj.cid, String(obj.voterName || obj.name || 'a friend').slice(0, 24));
    this.feed(this.skipVotes.get(obj.cid) + ' voted to skip (' + this.skipVotes.size + '/2)');
    this.changed();
    this.armSkipConfirm(obj.id);
  }

  armSkipConfirm(id) {
    if (this.skipVotes.size < 2) return;
    if (this.skipConfirmTimer) return;
    this.skipConfirmTimer = setTimeout(() => {
      this.skipConfirmTimer = null;
      if (this.now && this.now.id === id && this.skipVotes.size >= 2) {
        if (this.iAmHolder) this.confirmSkip(id, [...this.skipVotes.values()]);
        else setTimeout(() => { if (this.now && this.now.id === id && this.skipVotes.size >= 2) this.confirmSkip(id, [...this.skipVotes.values()]); }, 1200);
      }
    }, 400);
  }

  confirmSkip(id, voters) {
    if (!this.now || this.now.id !== id) return;
    const title = this.now.title;
    this.roomNote('⏭ Skipped “' + title.slice(0, 60) + '” — ' + (voters[0] === voters[1] ? voters[0] + ' confirmed' : voters.slice(0, 2).join(' + ') + ' voted'), true);
    this.advance();
  }

  roomNote(text, broadcast) {
    this.feed(text);
    if (broadcast) this.send({ t: 'note', cid: this.cid, name: this.name, text });
  }

  /* ---------- per-second tick ---------- */

  tick() {
    if (!this.room || this.closed) return;
    const now = Date.now();
    for (const [id, at] of this.removedIds) if (now - at > 300000) this.removedIds.delete(id);
    for (const [id, p] of this.pendingAck) {
      if (this.queue.some((t) => t.id === id) === false && !(this.now && this.now.id === id)) { this.pendingAck.delete(id); continue; }
      if (now - p.sentAt < ACK_MS) continue;
      if (p.retries >= ACK_RETRIES) {
        this.pendingAck.delete(id);
        this.feed('The room didn’t confirm “' + p.track.title.slice(0, 40) + '” — try cueing it again');
        continue;
      }
      p.retries++; p.sentAt = now;
      this.send({ t: 'add', track: p.track });
    }
    this.recomputeHolder();
    // End watchdog (cue build 4): past the known duration and nobody
    // advanced — but cross-examine the duration first; a player happily
    // playing PAST it means the duration was a lie (e.g. an ad length).
    if (this.now && this.now.durationMs) {
      const dur = this.now.durationMs / 1000;
      const elapsed = this.offsetFor(this.now);
      const pos = this.hooks.playerPos ? this.hooks.playerPos() : null;
      if (pos != null && pos > dur + 3) this.now.durationMs = null;
      else if (elapsed > dur + 10 && (pos == null || pos >= dur - 1.5)) this.onPlayerEnded();
    }
  }

  /* ---------- dispatch ---------- */

  handleMessage(obj) {
    if (!obj || typeof obj.t !== 'string' || obj.cid === this.cid) return;
    if (!this.msgLog) this.msgLog = [];
    this.msgLog.push({ t: obj.t, reqId: obj.reqId || undefined, rev: obj.rev || undefined });
    if (this.msgLog.length > 60) this.msgLog.shift();
    switch (obj.t) {
      case 'hello': this.notePeer(obj.cid, obj.name); break;
      case 'bye': this.roster.delete(obj.cid); this.recomputeHolder(); this.changed(); break;
      case 'add': this.handleAdd(obj); break;
      case 'remove': this.handleRemove(obj); break;
      case 'play': this.handlePlay(obj); break;
      case 'skipVote': this.handleSkipVote(obj); break;
      case 'ended': this.handlePeerEnded(obj); break;
      case 'bad': this.handlePeerBad(obj); break;
      case 'title': this.handleTitle(obj); break;
      case 'note': this.feed(String(obj.text || '').slice(0, 200)); break;
      case 'stateReq': this.handleStateReq(obj); break;
      case 'state': this.handleState(obj); break;
      case 'sync': this.handleSync(obj); break;
      case 'claim': this.notePeer(obj.cid, obj.name); break;
      default: break;
    }
  }
}

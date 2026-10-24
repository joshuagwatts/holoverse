# HOLOVERSE — build notes (started 2026-10-24)

Fork of limboverse (~/workspace/limbo, untouched) → new repo joshuagwatts/holoverse.
Target live: https://joshuagwatts.github.io/holoverse/

## Plan
- Phase 1: repo + Pages, minimal rebrand (HOLOVERSE), VRM avatar swap (orb default),
  FIGHT portal → SMASHVR. Ship live.
- Phase 2: instrument zones in jam/sound rooms (stand in zone to play).
- Phase 3: universal queue room (YouTube/SoundCloud/Spotify/Bandcamp/Drive/direct),
  shared room clock, auto-advance, graceful skips.

## Source map (limboverse, as copied)
- index.html (662 lines), css/style.css (2170)
- js/game.js (14579) — main world: movement, portals/realms, orb avatar, jukebox
- js/net.js (2386) — Trystero netcode, player state, juke broadcasts
- js/jam.js (676) — jam room instruments
- js/couch.js (748) — couch co-op / QR
- js/audio.js (137), js/flock.js (153)
- js/vendor: jsqr.js, qrcode.js
- NOT copied: sw.js (service worker — evaluate later), tools/ (LIMBO-scoped bump tool)

## Phase 1 — SHIPPED LIVE (2026-10-24, commit e7810834, build 1)
- Repo joshuagwatts/holoverse (public) + Pages; live boot verified headless
  (title HOLOVERSE, build stamp 1, 9 nexus portals incl. "fight", 0 page errors);
  served bytes == local for index/game/net/avatar/css.
- Rebrand: title/overlay/manifest/HUD copy; APP_ID 'holoverse_by_holowatts'
  (net fully isolated from limboverse); NO service worker in holoverse
  (registration stripped; limbo sw.js not shipped). Build pins start at ?v=1.
- VRM AVATARS (js/avatar.js): import .vrm in Settings → Avatar. Own file in
  IndexedDB 'holoverse'/'avatars' keyed by sha-256; localStorage pointer
  'holo_avatar'. Wisp payload gained `a:{h:hash16, n:name}` (rides both the
  data channel and the nostr relay fallback). Peers: cache hit → render the
  real VRM (procedural walk/fly bone swing + spring bones, baseYaw composed
  per the SMASHVR VRM0 lesson); cache miss → targeted avatarReq/avatarChunk
  transfer (48KB base64 slices, batches of 6, resumable, 24MB cap) → stored →
  rendered. Orb + nameplate until then; orb returns if they remove it.
- REMOTE-AVATAR TRUTH: other players DO see your actual VRM — the file
  itself travels peer-to-peer once per peer (then it's cached on their
  device across sessions). Verified in-sandbox by feeding a real 10.9MB
  SeedSan through the chunk handler: reassembled, stored, rendered;
  screenshot shows Mushy + SeedSan peers standing in the Nexus.
  The one unverifiable-here hop is the live data channel itself (VM blocks
  UDP) — the transfer code is a line-for-line mirror of the jukebox
  phone-file path that works in limboverse production.
- FIGHT PORTAL: 9th Nexus portal, red crossed-swords art, label "SMASHVR
  ARENA". External portal: proximity shows a prompt (tap or F) →
  window.open('https://joshuagwatts.github.io/smashvr/', '_blank').
  Smoke test (~/workspace/limbo-test/holoverse-smoke.mjs): ALL PASS —
  boot, nexus entry, portal list, prompt show/hide, local import, peer
  from cache, peer via chunk feed, 0 page errors.

## Progress log (cont.)
- Phase 2 next: instrument zones in the sound room.

## Phase 3 amendments (user decisions, 2026-10-24 — apply when Phase 3 starts)
- A1 NO SPOTIFY (queue rule): a source is only queueable if it can deliver
  full, synced playback to EVERYONE in the room. Spotify fails that (full
  track only for logged-in Premium; previews for everyone else) → OUT.
- A2 SPOTIFY SWAP EXPERIENCE: don't bare-reject pasted Spotify links.
  Identify the track keylessly via Spotify oEmbed (title+artist, no auth),
  search YouTube (keyless-first: Invidious/Piped public instances with
  fallbacks, or a tiny Cloudflare Worker proxy if needed) and offer the
  paster a swap card in the queue UI: "Spotify can't sync for everyone —
  found 'Song' by Artist on YouTube [Queue that instead] [Try a different
  link]". Room sees the swap ("X's Spotify pick swapped to YouTube so
  everyone hears it"). If no confident match: friendly prompt to the paster
  by name + a ready-made YouTube search link for that exact track.
- A3 REVERSED by A3R (below) — the official-only rule is GONE.
- A3R AUDIO IDENTITY is the criterion (user: "just make sure the audio is
  the same cuz we love remixes"): the match must be the same
  RECORDING/VERSION as the Spotify track, whoever uploaded it.
  * If the Spotify link is the original → match is the original. If it's
    a specific remix/edit (title carries "(X Remix)" etc.) → match must
    be THAT remix. Remixes welcome; version identity is what matters.
  * WRONG AUDIO (reject): covers / different performances, a DIFFERENT
    remix than the one linked, sped-up/slowed/reverb/nightcore/8D
    alterations (altered audio — also betrayed by duration drift),
    mashups, live version when the link is studio (and vice versa).
  * AUDIT SIGNALS (heavy auditing stays, re-aimed): (a) normalized title
    match INCLUDING version suffixes/remix credits — candidate missing
    the linked version's remix credit FAILS; candidate adding a
    different version credit FAILS; (b) artist name match; (c) duration
    tight tolerance (~±2s) whenever Spotify duration is obtainable —
    tempo edits/wrong versions usually drift outside it; (d) uploader
    signals (official/Topic) demoted to a confidence booster only.
  * KEPT from A3: post-load verification (read back loaded
    title/channel/duration BEFORE the room hears it; mismatch → abort
    swap, room note, prompt for another link), the visible audit trail
    (candidates, signals passed/failed, verdict — reachable from the
    queue item, "why this version?"), and the bias: uncertain = refuse
    and ask for another link. Missed match = friction; wrong audio in
    the room = failure.
  * (Superseded A3 text, kept for the record: official-channel-only
    matching with hard-reject keywords — replaced in full by A3R.)
- A3F FINAL RULING (supersedes A3/A3R wherever they conflict): "Don't
  refuse anything — if somebody loaded a cover, find the cover. If
  somebody loaded a sped up edit, find the sped up edit." NOTHING is
  refused for being a cover / sped-up edit / remix / live version / any
  other variant. The matcher's ONLY job is VERSION FIDELITY to the
  linked track: whatever the Spotify link actually is — original,
  specific remix, a cover, a sped-up edit — the YouTube match must be
  THAT same version/audio.
  * Version qualifiers are part of the track's identity: link says
    "sped up" → candidate must be the sped-up one (the original is a
    WRONG match); link says "cover" → find that cover, by that cover
    artist as credited on the link; link is a live recording → find
    that live recording.
  * Signals: normalized title INCLUDING all version credits/qualifiers;
    artist(s) as credited on the link (for covers, the cover artist);
    duration judged against the LINKED track's own duration (a sped-up
    edit is SHORTER — never judge against the original's duration).
  * Uploader identity (official/Topic) is now irrelevant except as a
    weak confidence signal. Alteration keywords are no longer rejects —
    they are identity markers that must MATCH the link.
  * KEPT: post-load verification (read back loaded title/channel/
    duration before the room hears it; mismatch → abort + prompt),
    visible audit trail, uncertain = ask for another link (uncertainty
    is the only refusal left).
  * ONE-SENTENCE SPEC: the swap finds the same audio the person
    actually linked, whatever kind of audio that is.

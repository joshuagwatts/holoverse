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

## Phase 2 — SHIPPED LIVE (2026-10-24, commit 25913294, build 2)
Sound-room instrument zones (world.zones from buildSoundRoom):
  DRUM KIT 🥁 (-13,-5) · SYNTHESIZER 🎹 (13,-5) · HAND PAN 🛸 (-13,11) ·
  BASS RIG 🎸 (13,11) — floor ring + prop + floating label each, r=3.4,
  must be below y=6. zoneTick (per frame): the zone you're in owns the jam
  UI — jam button relabels to the instrument, a "— tap to play" chip opens
  the panel on that instrument, tabs refuse other instruments with a hint,
  walking/flying out closes the panel, ring-to-ring swaps the instrument.
  Remote jammers unchanged (jamMarkJammer/room list already show who's on
  what). Smoke (limbo-test/holoverse-zones.mjs): ALL PASS, 0 page errors;
  screenshot confirms ring + kit + chip render.

## Phase 3 — SHIPPED LIVE (2026-10-24, build 3; worker holoverse-resolve)
Universal queue on the existing jukebox (same room clock: item + startedAt
+ offset, late joiners land mid-track, holder election + watchdogs).
- Providers now: youtube, youtube-playlist, soundcloud (+set/short),
  direct-audio (direct media URLs), phone-file, bandcamp, drive.
- GOOGLE DRIVE: share links (/file/d/<id>, ?id=) queue as 'drive'; playback
  is a plain media element on the public stream URL; private/unservable
  files error → 15s load watchdog → skip with a room note.
- BANDCAMP: track/album pages resolve at queue time to Bandcamp's OWN
  mp3 streams (worker /bandcamp: page → data-tralbum; albums expand into
  a grouped set) and play through the direct player = fully synced.
  The official embed is never used (it can't be driven by the room clock
  — per the A1 rule it would not be queueable). Bandcamp bot-walls
  datacenter IPs, so the worker chains fetch paths: direct → Google
  Translate proxy → Jina reader (HTML mode); successes are edge-cached
  30 min; worker accepts an optional JINA_API_KEY secret. If no path can
  read the page, the add is refused plainly ("can't sync ⇒ can't queue").
- SKIP-NEVER-WEDGE: playback errors announce on the new net action
  jukeSaid (server channel): "⏭ couldn't play "X" — skipping" from the
  phone holding advance duty, then the holder advances (build-104 path).
- SPOTIFY SWAP (A1+A2+A3F, final spec implemented in swapMatch & friends):
  spotify links (incl. spotify: URIs and spotify.link shorts) NEVER queue.
  Identify keylessly via worker /spotify (embed page JSON: title, artists,
  duration; oEmbed from the browser as a degraded fallback), search
  YouTube keylessly (worker /ytsearch; Invidious instances as fallback),
  judge candidates on AUDIO IDENTITY: exact version-qualifier set
  (remix credit / sped up / slowed / reverb / nightcore / 8d / live /
  acoustic / cover / mashup / extended / radio edit / demo / remaster —
  remaster ignored on video uploads), title core, artist credit (an
  uncredited upload can pass ONLY when title+version+duration all match
  exactly), duration ±2.5s against the LINKED version. Official/Topic
  channel = confidence boost only. Winner → swap card to the paster
  ("found '…' on YouTube [queue that instead] [try a different link]");
  queueing broadcasts "🔁 X's spotify pick swapped to youtube…"; the item
  carries its audit trail ("🔁 from spotify — why this version?" on the
  queue row). No winner → friendly card + one-tap YouTube search link for
  the exact track. Post-load verification: when the swapped track starts,
  the adder re-reads the loaded title/channel (noembed) and re-judges;
  mismatch → room note + skip + re-prompt.
- VERIFICATION (limbo-test/holoverse-queue*.mjs): provider detection 5/5;
  matcher units 7/7 (plain→official wins, 2022-remaster refused, sped-up
  refused for a plain link; remix link→that remix only; sped-up link→the
  sped-up edit, original refused; cover link→that cover by that artist;
  karaoke never matches); live swap of a real Spotify link offered the
  official Rick Astley video, queued it, and it survived post-load
  verification; bandcamp item queued + played the real bcbits stream
  (client proven with a real captured resolve — the sandbox's shared
  egress IPs are rate-limited by every public fetcher, so the worker
  chain's live proof is the earlier end-to-end success + per-path
  verification from a clean IP); fake drive file + dead mp3 both became
  now-playing, failed, and skipped themselves. 0 unexpected page errors.

## What's left / known limits
- Two-phone multiplayer proof (avatar transfer + queue sync live-fire)
  needs Joshua's phones — the VM blocks UDP, so data channels can't be
  exercised here; all P2P code mirrors limboverse production paths.
- Bandcamp resolve depends on public fetch paths that rate-limit shared
  IPs; the edge cache + optional JINA_API_KEY secret are the pressure
  valves. If it ever matters, a free jina.ai key in the worker secret
  makes it boring.
- Spotify album/playlist links get the "paste a track link" card (the
  swap is per-track by design).
- Plain .glb (non-VRM) avatar imports are rejected with a status line;
  SMASHVR's autorig path could be ported if wanted.

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

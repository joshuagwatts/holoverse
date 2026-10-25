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

## Build 4 — THE ENDLESS BOX (started 2026-10-25)
New Nexus portal world (10th portal): a box in a box — an enclosed chamber
with a miniature of itself on its central plinth, itself sitting inside a
giant copy. Step into the miniature → descend (it becomes your chamber);
out the exit door → ascend (you emerge at the parent chamber's plinth).
Endless both directions, integer depth, no loads. Design:
- Scale ratio R = 1/7 held everywhere. Exactly 3 copies exist (parent shell
  ×7, current chamber ×1, miniature ×1/7) — level changes RECYCLE by
  relabel: copies are identical, so a swap = depth counter + player
  teleport + retint, masked by a ~300ms FOV whoosh. Constant cost.
- Per-depth palette drift (hue rotates with depth), dust motes, minimal
  HUD = depth readout only (SURFACE / −n / +n).
- Multiplayer: depth rides the wisp as `e` (net.js broadcast, same
  pattern as avatar `a`). Same depth → rendered normally; one depth down
  → tiny marker inside my miniature; any other depth → not rendered.
- Room key 'limbo-realm-8', world key 'endlessbox' (the existing
  'journey' ENDLESS JOURNEY room is a different place — untouched).

## Build 4 — SHIPPED LIVE (2026-10-25, build stamp 4)
- Chamber (26×26×12): plinth (2 steps, top y=1.7) at centre, exit door in
  the north wall with a trim frame + glow, ceiling oculus (9×9, glassed)
  revealing the parent shell — its giant emblem + halo read through it.
  Floor is a canvas texture: etched nested squares around the plinth.
  A 3-ring square sigil floats over the plinth in every copy.
- Copies: parent ×7 (position y=-11.9 so its plinth top is our floor) is
  built withMini:false — our chamber occupies its miniature slot; current
  ×1 recurses nest=2 (miniature + miniature's miniature). Z-fighting:
  coplanar floor/plinth-top pairs lifted 0.02 apart.
- Triggers (endlessTick): cylinder r=2.6 around the miniature (y 1.25–4.9)
  descends; door alcove (z<-12.25, |x|<1.7, y<4.5) ascends. Latches are
  re-derived from the arrival position inside endlessSwap, so tick order
  can never chain-fire or lock a zone. Post-swap cooldown 0.35s (the
  latch does the real anti-chain work).
- Descend arrival = player pos / EB_R clamped inside the walls (touch the
  mini's south face → land inside the south wall, still facing north;
  facing preservation measured dot=1.000 in tests). Ascend arrival =
  parent plinth, just north of its miniature (0, 2.4, -3.9).
- Tint: ebDepthColor rotates hue 0.055/depth on trim emissives, sigil,
  door glow, halo + copy lights; fog/background take the current tint
  darkened. Depth 0 violet → −2 reads blue-cyan (screenshot-verified).
- HUD: #depth-hud (fixed, top-centre, mono) — SURFACE / −n / +n; the text
  is written inside endlessSwap so it can never lag the depth by a frame.
- Bounds: new 'endlessbox' branch in updatePlayer (x ±12.2, y 0.35–11.2,
  z −13.4…12.2 — the extra north reach is the door alcove).
- VERIFY (limbo-test/holoverse-endless.mjs, local server :8923 — :8917
  was claimed by the smashvr work; all holoverse suites re-pinned to
  8923): ENDLESS ALL PASS — boot/HUD/scales (parent 7, mini 1/7 @ plinth),
  10 nexus portals, descend ×3 + ascend ×3 with arrivals + HUD text,
  peer gating at the handler (one-down → marker scale 1/7 at exactly
  [x/7, 1.7+y/7, z/7] inside the miniature; same-depth → scale 1; far →
  removed), HUD hides + FOV restores on exit, 0 page errors.
  Regressions: holoverse-smoke ALL PASS, holoverse-zones ALL PASS,
  holoverse-queue PASS (0 fails). Screenshots: verify/eb-depth0.png
  (spawn composition), eb-depth-2.png (tint drift + recursion on plinth),
  eb-parent.png (oculus + parent halo/trim scale cues).
- KNOWN SEAMS: (1) the oculus is glassed — you see the parent, you can't
  fly out through it (ascend is the door, by design); (2) swap arrivals
  keep velocity, so a full-speed dive at the miniature lands you deep in
  the next chamber still moving — reads as flying through, intended;
  (3) peers MORE than one depth away don't render at all (no giant/tiny
  ghosts beyond the one-down marker); (4) two-phone proof of depth
  markers over a live data channel is still Joshua's-phones-only, same
  UDP limit as everything else — the handler path is fully proven here.
- Harness gotcha found mid-build: loop() clamps dt to 0.05, so at
  swiftshader's ~1-3fps game time crawls ~8× slower than wall time;
  waits/timeouts in holoverse suites must budget for it (the 0.9s→0.35s
  cooldown cut was partly this, partly snappier chaining on-device).

## Build 5 — SHIPPED (2026-10-25): CUE ROOM LINK (5a) + THEATRE SYNC (5b)

### 5a — the jukebox links to a Cue Room by code
New file **js/cuelink.js**: a faithful port of the cue-room wire
protocol (its relay, app, providers sources audited line-by-line) —
`CueRelay` (Nostr kind 20001, tag `cueroom_by_holowatts:<CODE>`, the
same 3 pinned relays, mid dedupe, outbox, backoff; nostr-tools via
esm.sh, ephemeral key per session) and `CueClient` (the whole session
machine: hello/roster TTL 25s, lowest-cid holder election, handoff
collection 2.5s with build-4 scoring, stateReq at +1.2s/+6s + state,
holder sync rev-guarded every 10s + on mutation, add/remove with
pendingAck retry, play/stopped with contention rules, skip = 2
distinct voters — holder confirms +400ms, threshold voter falls back
+1200ms, solo second-tap exception, ended honored only in the end
window, bad reports need 2 distinct reporters or the holder's own
stuck player, non-holder errors self-heal instead of advancing the
room, clock-skew correction from message `at`, 1s end watchdog).
Player/DOM effects are hooks into the jukebox (onPlay → jukeAdoptPlay,
onStop, onQueue → panel mirror, onFeed → chat lines, playerPos/Dur
from the live juke player, selfHeal → restart own player).

Game side (js/game.js): a "link cue room" row in the jukebox panel
(code input + link/unlink + a live status line: room, relays, holder,
headcount). While linked:
- The cue session is the jukebox's source of truth. The panel queue is
  a mirror of the cue queue; now-playing flows through the cue play
  events into the normal provider stack (YouTube incl. playlists,
  SoundCloud, Bandcamp streams via streamUrl, Drive via driveId,
  direct) — including another app's tracks.
- In-world adds run the full local pipeline first (Spotify → the
  existing swap flow; Bandcamp → resolve; playlists → fan-out) and
  convert to cue tracks at the single enqueue gate (jukeSendAdd).
  Phone-file and 'external' adds are refused with a plain note —
  they cannot sync for everyone, so they never enter the room.
- In-world skip = a cue skip VOTE (jukeSkipNow routes to voteSkip).
  Player end/error intents route through jukeAdvance's gate into the
  cue rules. Local Trystero juke handlers/sync are ignored (not torn
  down); clearing is refused with a note (the protocol has no clear).
- Offsets for a cue now-playing use the client's skew-corrected clock
  (jukeOffsetFor gate) — the origin device's clock is not trusted raw.
- The local line (queue + now) is parked on link and restored exactly
  on unlink; the cue cid persists (localStorage holoverse-cue-cid) so
  election/addedBy identity is stable across visits.

**Link protocol truth table**

| question | answer |
| --- | --- |
| Who holds? | Lowest cid across BOTH apps (cue app + holoverse clients elect identically; a holoverse client can hold) |
| Who advances? | The holder, under cue rules (end window, corroborated bad reports, confirmed skips); non-holders report ended/bad |
| What mirrors world→app? | Adds (converted), title enrichments, skip votes, notes |
| What mirrors app→world? | Queue, now-playing (+stopped), holder identity, roster-driven feed lines |
| Skip in-world | A vote; 2 distinct voters confirm (solo: 2nd tap) |
| Unlink | Cue session untouched; jukebox restores its parked local line mid-track |
| Unplayable in-world | Phone-file / external refused at the gate with a note; unplayable cue items follow cue bad-track rules — the room never wedges |

### 5b — the theatre screen follows the jukebox
The theatre (build 75/76) already had a synced screen — but its own
YouTube-only queue. Now the screen is a VIEW of the jukebox session
(local or cue-linked — both land in juke.now):
- **YouTube items**: the theatre's own YT player loads the same video
  MUTED (the jukebox stays the room's only audio), positioned from
  the jukebox room clock: theatre.position/startedAt are derived from
  jukeOffsetFor on every session change, theatreApplyState does the
  load/seek, and a throttled tick re-seeks on >2s drift (one clean
  seek, never a chase). Walking in mid-song lands at the live offset.
- **Drive items**: a muted <video> in a new screen layer, streamed via
  the resolve worker's /drive proxy (Drive's own host blocks
  cross-origin media — the cue-room build-2 lesson), uc URL as
  fallback; audio-only files fall back to the card on loadedmetadata.
- **Audio items** (SoundCloud, Bandcamp, Drive audio, direct,
  phone-file): a now-playing CARD on the screen — title, who queued
  it, provider, progress bar + elapsed/total against the room clock.
- The theatre's own session is parked on takeover and restored when
  the jukebox idles; remote theatre state messages are ignored while
  juke-driven (every client derives the screen from the shared juke
  session independently). A retry in the juke tick keeps asking the
  API loader for the player (its 12s fail-latch could strand the
  theatre's one-shot build on slow networks).
- Panel note/byline attribute the screen to the jukebox while driven.

### Verification (headless, this sandbox, 2026-10-25)
- **holoverse-cuelink.mjs — ALL PASS** (two real browser contexts,
  cue-room app + holoverse, REAL relay network): room created in the
  app; holoverse links by code; mutual discovery; exactly one holder
  and both apps agree who (the app held in the passing run — election
  is symmetric); a track cued in the app plays in-world (real
  direct-audio player, positions progressing 3.0s→6.5s); a track cued
  in-world appears in the app's queue with the right addedBy; one
  skip vote records and does NOT skip; the second vote (other app)
  advances BOTH apps to the YouTube track, which holoverse then plays
  (kind=youtube); unlink restores holoverse's empty local line while
  the cue session plays on; 0 page errors in both apps. A separate
  probe also proved joining a room with a track ALREADY playing
  (adoption via the holder's sync/state — now mirrored in ~24s,
  bounded by sandbox socket warm-up).
- **holoverse-theatre.mjs — ALL PASS**: audio track → card on the big
  screen (title, progress advancing with the room clock 0:07→0:11 of
  2:00); YouTube track → the actual video on the screen, player time
  7.6s vs room offset 9.1s; leave + re-enter mid-song → 23.2s vs
  24.3s; jukebox stop → screen released to the theatre. Screenshots:
  verify/th-card.png, verify/th-video.png, verify/th-reentry.png.
- Regressions: smoke ✓, zones ✓, endless ✓ (ENDLESS ALL PASS) — all
  re-run on the final build-5 tree; cuelink re-run too ✓. **Queue
  suite: local phases pass (provider detection, matcher units), but
  its live-network phases (Spotify oEmbed/swap search, Bandcamp
  resolve) could not complete at ship time** — the sandbox proxy
  times out on those hosts (verified directly: worker + Spotify
  unreachable via proxy, worker answers 200 direct). The full queue
  suite passed this morning on the build-4 tree, and build 5 does not
  touch the swap/resolve code paths. Re-run it when egress cooperates.
- Sandbox lessons banked: YouTube embed error 150 fires for some
  videos from this egress (Gangnam) while others play (Big Buck
  Bunny, the stack's warm-up video) — the theatre's error line
  surfaces it honestly; a cold YT API load here takes ~20s, longer
  than the jukebox play watchdog, so players must be warm before
  timed assertions; a cue track left "playing" with a wedged player
  still ends by its room clock (duration watchdog) — correct room
  behavior, observed live.

### Limits / what's left for real devices
- Two-PHONE proof (Joshua's): link a cue room from a phone in-world
  while friends use the app — relay-level proof here is two browser
  contexts on the real relays; WebRTC isn't involved in the link at
  all (relay-only), so this should transfer directly.
- The theatre's screen shows one jukebox video per client locally;
  two people in the theatre each run their own screen player against
  the same room clock (same model as the theatre's own sync).
- Drive VIDEO in the theatre is proven by construction (worker proxy
  + metadata check), not by a live Drive file in the sandbox — the
  proxy path itself is the one cue-room build 2 verified end-to-end.
- Spotify cued FROM the cue app arrives as the app's own swap result
  (a YouTube track) — in-world swap flow only applies to links pasted
  in-world, same as each app standalone.

## Build 6 — SHIPPED (2026-10-25): ENDLESS BOX swap-loop fix
User report from his phone: "Its lowkey freakin out in that room" —
"Def some kinda loop issue." He was right.

ROOT CAUSE (reproduced headless, limbo-test/holoverse-endless-loop.mjs,
which FLIES with held keys — the build-4 suite only teleported with
zero velocity, so it could never see this): build 4's anti-repeat
protection was two "latches" re-derived from the ARRIVAL position
inside endlessSwap. But the scale map (entry x7, wall-clamped) lands
nearly every arrival OUTSIDE the new chamber's trigger zone, so the
latch was born cleared — the machine had no memory a swap had just
happened, and mere presence in the zone re-fired. Compounding it, the
descend zone was an invisible bubble (hd<2.6, y 1.25..4.9) extending
~0.75u past the miniature's walls and ~1.5u ABOVE its roof (mini spans
hd<=1.86, y 1.72..3.43). Measured on the old code: holding forward from
spawn = descend -> descend (transit re-fire) -> ascend (arrival slam
at z=-11.6 coasted into the door alcove) in one held input; overflying
the miniature at y=4.3 = 2 descents without touching it; standing
perfectly still inside the zone after arriving = another descent.
Cycle time was just whoosh 0.32s + cooldown 0.35s, so on a 60fps phone
the depth counter spins and the FOV strobes — the freak-out. Ruled out
with evidence: handler/tick accumulation (one trigger after 3 room
re-entries fired exactly once) and whoosh non-termination (idle FOV
steady at 70).

FIX (js/game.js, endless sections only — 58-line diff vs build 5):
- Explicit arm/disarm state machine replaces the position latches.
  A swap (and room entry, and the trigger itself) DISARMS both
  triggers; they re-arm only after the player has been fully OUTSIDE
  both zones for a continuous 0.5s (endless.outTime; any tick inside
  either zone zeroes the beat, so boundary-hovering can't arm either).
  Standing still after arrival can never re-fire, period — wherever
  the arrival lands.
- Descend zone tightened to the miniature's true volume: hd<2.05,
  y 1.45..3.75 (was hd<2.6, y 1.25..4.9). Flying OVER the little room
  or past its walls no longer counts as entering it. Door alcove
  unchanged. Whoosh, facing preservation (dot=1.000 re-verified),
  depth HUD, tint drift, peer depth markers all unchanged.
- endlessState() test hook gained `armed` + `outTime`.

VERIFICATION: holoverse-endless-loop ALL PASS (hold-W: exactly 1
deliberate descent, 0 swaps after release; overfly: 0 swaps, was 2;
stand-still-in-zone: 0 extra swaps, was 1; 3 re-entries + 1 trigger:
exactly 1 swap; idle corner: 0 swaps, FOV steady 70; 0 page errors).
holoverse-endless ENDLESS ALL PASS (its teleport rounds now stage on
the `armed` flag — same assertions: arrivals, HUD, scales, peer
gating). holoverse-smoke: boot stamp build 6, 0 page errors.
holoverse-zones: all behaviors correct, 0 page errors.
- holoverse-cuelink: 9 failures in the playback-mirroring phase —
  PROVEN ENVIRONMENTAL, not a build-6 regression: a control run with
  the pristine live build-5 game.js swapped in fails with the
  IDENTICAL 9 (and a retry on the fixed tree likewise). Browser
  consoles show ERR_CONNECTION_REFUSED on media loads while the relay
  protocol (create/link/discover/holder agreement) passes on every
  run; the cue app's own player never progresses ("null -> null") in
  this sandbox today. Same egress flakiness class build 5 documented.
  Re-run cuelink when sandbox egress cooperates.




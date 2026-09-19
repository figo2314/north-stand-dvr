# Resume Checkpoint

Updated: 2026-09-19

## Current State

- The local app is implemented and runs at http://127.0.0.1:4173.
- The mobile home entry is now `看球`; it opens one library containing
  currently playable online replays and local recordings.
- Online and local items are visually separated as `线上回放` and `本地录像`.
- The latest published commit before the current uncommitted UI cleanup is
  `5e6cfc0 Add build version and simplify mobile home launcher`.
- The match radar mockup is available at http://127.0.0.1:4173/mockup.html.
- Radar match actions now create or remove real scheduled fixtures through the
  local API and carry the selected M3U stream URL into the recording schedule.
- Ended radar entries now use a dedicated replay recording path that bypasses
  the kickoff window and records the full replay duration.
- Alternate commentary feeds get distinct output filenames, and interrupted
  recording jobs are marked as failed when the service restarts.
- Demo fixtures and the demo recording have been removed from `data/db.json`.
- A real 60-second M3U replay was recorded and added to the library for playback
  verification.
- The main app includes scheduled recording, FFmpeg integration, spoiler-safe
  state, player masking, local recording discovery, and resume playback.
- The radar reads its sports entries from the configured M3U source.

## Latest Verification

- `npm test`: 43 tests passed.
- `npm run test:ui`: 28 browser tests passed.
- A real M3U full replay was captured for 60 seconds and retained for playback.
- The VM deployment now uses Ubuntu's native FFmpeg through
  `deploy/ffmpeg-host.sh`; the static glibc build was confirmed to crash only
  when resolving hostnames.
- The Docker service uses an IPv6-enabled dual-stack network because the M3U
  source resolves to IPv6 only.
- Active recordings expose live progress, periodic frame previews, graceful
  stop-and-save, and cancel-and-discard controls.
- Persistent runtime logs cover scheduler failures, source errors, recording
  start/complete/failure/missed states, settings, and library operations.
- Radar entries retain and display commentator names when the M3U source
  includes them; commentator names are also searchable.
- Live and replay feeds can be watched directly through a same-origin HLS
  proxy, with HD level selection, bitrate/buffer stats, score shielding, and
  pause/resume controls.
- A dedicated live-channel page lists all non-football M3U groups with search,
  group filters, H.264-aware quality selection, channel fallback, and the same
  live playback controls.
- Channel rows progressively show detected resolution labels with a six-hour
  local cache; unavailable channels are marked without repeatedly probing them.
- Live sources are now managed on the server with priority, fallback URLs,
  enabled state, merged channel lists, and persistent health records.
- XMLTV EPG links are detected from M3U headers and show current and next
  programmes in the channel list.
- The channel page supports smart sorting, playable-only filters, recent
  channels, per-channel details, mobile landscape playback, gestures,
  picture-in-picture, remote playback, wake lock, and media-session controls.
- A web manifest and service worker make the interface installable and cache
  the application shell for mobile use.
- Read-only TV endpoints now publish M3U, XMLTV EPG, and proxied HLS streams
  for Apple TV and other IPTV players without exposing upstream source URLs.
- Match lineups are resolved from TheSportsDB and API-Football, cached on the
  fixture, displayed on a dedicated pitch page, and can be completed manually
  when a free provider only returns partial data.
- A dedicated football live page filters sports groups and football matches
  from the same playlists while reusing the full live player and health tools.
- `/api/state` responded successfully.
- The configured M3U source returned 137 channels and 13 sports channels.

## Recent Fix

- Ended matches now show `录像已就绪` instead of an incorrect `0 分钟后`.

## Resume Instructions

1. Read this file first.
2. Check `git status --short --ignored`.
3. Run `npm test` before changing server or data behavior.
4. Keep work focused on the existing North Stand DVR product.

## Development Workflow

- Work locally: implement, test, and verify changes in this workspace.
- Do not deploy, SSH into VMs, or modify proxy configuration during normal
  development.
- Do not commit or push unless the user explicitly says `发布`.
- When the user says `发布`, run the relevant tests, commit the changes, and
  push the `main` branch to GitHub.
- The VM deployment agent is responsible for pulling and deploying published
  commits.

## CC Switch Safety

Use single text-based tool calls where possible. Avoid parallel tool calls,
image inspection tools, and large history reads in the same turn. If the task
channel fails again, start a new task with:

`继续看球项目，从 PROGRESS.md 恢复`

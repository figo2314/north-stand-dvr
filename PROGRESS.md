# Resume Checkpoint

Updated: 2026-09-16

## Current State

- The local app is implemented and runs at http://127.0.0.1:4173.
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

- `npm test`: 15 tests passed.
- `npm run test:ui`: 5 browser tests passed.
- A real M3U full replay was captured for 60 seconds and retained for playback.
- `/api/state` responded successfully.
- The configured M3U source returned 137 channels and 13 sports channels.

## Recent Fix

- Ended matches now show `录像已就绪` instead of an incorrect `0 分钟后`.

## Resume Instructions

1. Read this file first.
2. Check `git status --short --ignored`.
3. Run `npm test` before changing server or data behavior.
4. Keep work focused on the existing North Stand DVR product.

## CC Switch Safety

Use single text-based tool calls where possible. Avoid parallel tool calls,
image inspection tools, and large history reads in the same turn. If the task
channel fails again, start a new task and ask to continue the 看球 project from
this checkpoint.

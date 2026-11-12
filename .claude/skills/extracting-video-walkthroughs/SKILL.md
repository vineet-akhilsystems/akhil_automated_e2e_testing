---
name: extracting-video-walkthroughs
description: Use when a BA walkthrough video (.mp4/.webm/.mov/.mkv) uploaded to Test Studio shows "Stored - needs a transcript" or "Keyframes only", when asked to get requirements out of a screen recording, or when changing video handling in portal/intake.mjs or qa/tools/extract-video-intake.mjs.
---

# Extracting video walkthroughs

**Core principle:** video extraction is optional, local and bounded. It never interprets visuals; it only produces a transcript and a timestamped keyframe index that a human or the analyst can then read.

## Statuses

| Status | Meaning | What the text contains |
|---|---|---|
| `ok` | A transcript exists | Timestamped transcript, plus keyframe index if ffmpeg ran |
| `partial` | Keyframes only, no transcript | Note that visuals are NOT interpreted, plus `[mm:ss] keyframe frame-001.jpg` lines |
| `unsupported` | No transcript and no ffmpeg | The existing "Needs transcript" note |

`partial` is readable-with-note: never treat keyframe names as requirements. Record "video visuals not reviewed" under `openQuestions` and cite only transcript text.

## How it works

1. A sidecar transcript with the same base name (`.srt`, `.vtt`, `.txt`) uploaded to the same module, or next to the file, is used first.
2. If `ffmpeg` and `ffprobe` are on PATH, scene-change keyframes (`gt(scene,0.35)`, 1280px wide JPEG, max 40) go to `<data>/intake/<moduleId>/<fileId>-frames/`.
3. If no sidecar exists and a `whisper` CLI is on PATH, it transcribes locally.
4. Result is saved in `<file>.extract.json` as `text`, `tables`, `frames`.

Limits: videos over 2 hours are skipped, ffmpeg runs under a timeout, frames are capped by count and total bytes. All tools run via `execFile` with argument arrays, never a shell.

## Operating it

- Fastest fix for an `unsupported` or `partial` video: upload a sidecar transcript named like the video (`walk.mp4` and `walk.srt`), then re-upload the video, since extraction runs once per upload.
- Try one file by hand: `node qa/tools/extract-video-intake.mjs <video> [framesDir]` prints only status, character count and frame count.
- Tests inject a fake `exec`; never require ffmpeg in tests and never run extraction on the large sample mp4s in tests.

## Common mistakes

- Reporting a `partial` video as analysed. State that only frames exist.
- Interpolating file names into a shell string. Pass arguments as an array.
- Logging transcript text. Log status and counts only.
- Comparing `extract === 'ok'` alone; also handle `'partial'`.

## Verify

`node --test portal/test/intake.test.mjs`

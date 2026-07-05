# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

Double-click `serve.bat` or run it from the terminal to start a local HTTP server on port 8080 (requires Python). Then open `http://localhost:8080` in a browser.

Alternatively, open `index.html` directly in a browser (no server needed for basic use, but Web Audio API may require a server origin on some browsers).

## Architecture

This is a single-file vanilla JS/HTML guitar chord practice app with no build step, no dependencies, and no external assets.

**`index.html`** (identical copy: `guitar-practice.html`) contains everything:

- **Chord data** (`CHORDS` object, line ~444): two pools — `beginner` (Am, A, Em, E, G, C, D) and `intermediate` (Dm, Bm, F). Each chord entry carries finger positions, open strings, muted strings, and optional barre info. Adding new chords means extending these arrays with the same shape.

- **Fretboard SVG renderer**: Two modes drawn by `drawFretV` (standard vertical diagram) and `drawFretH` (horizontal/neck-flat diagram), toggled via `setFretOrient`. Both build SVG markup as an HTML string injected into `svg.innerHTML`. String numbers count from 1 (high e) to 6 (low E).

- **Metronome** (`sched` / `startMetro` / `stopMetro`): Uses the Web Audio API (`AudioContext`) with a 20ms scheduler interval. Beat timing is ahead-of-time scheduled (`nextT`) to avoid jitter. Auto chord-switching fires via `setTimeout` aligned to `nextT`. The "soon" warning on the next-chord pane is triggered one bar before the switch.

- **State**: All mutable state is module-level vars (`pool`, `deck`, `idx`, `hist`, `bpm`, `beats`, `bar`, `beat`, `barsPerSwitch`, `timerIv`, `fretIsHoriz`). No framework, no persistence (settings reset on reload).

- **Layout**: CSS custom properties in `:root` drive sizing. Portrait vs landscape layouts are handled entirely with `@media (orientation: portrait/landscape)`. The `--fscale` CSS variable (set by `setFontScale`) scales landscape text/SVG sizes.

- **Finger color map** (`FC`): finger 1=green, 2=blue, 3=brown, 4=purple, B(arre)=accent orange.

## Auto-commit hook

`.claude/settings.json` runs `.claude/hooks/auto-commit.ps1` after every Write/Edit, committing that file's change immediately (`auto: update <filename>`) so history stays fine-grained and easy to review or revert.

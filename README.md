# Visual Piano
# Built by Pratham using Codex

A Synthesia-style MIDI practice app. Load a `.mid` file, watch note fall visualization aligned to an 88-key keyboard, and practice with loop tools.

## Features
- MIDI load via file picker or drag-and-drop
- Falling-note highway synced to keyboard playback
- Loop workflow with marks, loop toggle, and editable loop timestamps
- Hand filtering (`both`, `left`, `right`) with a single cycle button
- Multiple built-in synth presets (including `Organ`)
- Seek marks + loop-segment overlay on the transport bar
- Keyboard shortcuts for transport and loop workflows

## Run
1. From the project folder, start a static server:
   `python3 -m http.server 4173`
2. Open:
   `http://127.0.0.1:4173`

## Project Structure
- `index.html`: semantic page markup and CDN script includes.
- `styles/main.css`: all styles (layout, controls, responsive behavior).
- `js/main.js`: app runtime orchestration (state, rendering, UI events, transport).
- `js/modules/time-utils.js`: time formatting/parsing utilities.
- `js/modules/marks-utils.js`: sorted mark operations and loop segment resolution.

## Core Logic Overview
- MIDI parsing: `@tonejs/midi` is used to read tracks, notes, tempo map, and time signatures.
- Audio engine: Tone nodes are lazily initialized on first user gesture to satisfy autoplay policy.
- Rendering: a canvas animation loop draws grid + falling notes from transport time.
- Loop system:
  - marks are stored sorted,
  - active loop segment resolves from current playhead position,
  - loop timestamps are editable and update marks + segment overlay.
- Seek behavior: heavy seek refresh work is throttled while dragging and flushed on drag end.

## Developer Notes
- Keep pure logic in `js/modules/*` and UI/transport orchestration in `js/main.js`.
- If adding a new control, wire DOM + state + toast updates together so UX stays coherent.
- For sampled piano replacement, swap synth construction in `js/main.js` audio section.

## Hotkeys
- `Space`: play/pause
- `R`: stop
- `Left`/`Right`: seek `-2s` / `+2s`
- `Shift + Left`/`Shift + Right`: seek `-5s` / `+5s`
- `M`: add loop mark
- `N`: jump to next mark
- `L`: toggle loop
- `H`: cycle hand mode (`both -> left -> right`)
- `[` or `-`: speed down
- `]` or `=`: speed up
- `0`: reset speed
- `?`: show hotkey help

## License
MIT. See `LICENSE`.

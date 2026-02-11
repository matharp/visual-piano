# Visual Piano

Simple Synthesia-style MIDI player and practice tool.

Live app: https://matharp.github.io/visual-piano/

## What It Does
- Loads MIDI files (picker or drag-and-drop)
- Shows falling-note piano visualization
- Plays through built-in synth sounds
- Supports loop marks, hand split modes, and keyboard instrument mode

## Run Locally
1. Start a static server:
`python3 -m http.server 4173`
2. Open:
`http://127.0.0.1:4173`

## Main Files
- `index.html`
- `styles/main.css`
- `js/main.js`
- `js/modules/time-utils.js`
- `js/modules/marks-utils.js`
- `assets/default.mid`

## License
MIT (`LICENSE`)

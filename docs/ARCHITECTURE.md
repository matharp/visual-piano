# Architecture Notes

## Runtime Layers
- **Markup (`index.html`)**: static DOM skeleton, external script/style references.
- **Styles (`styles/main.css`)**: all visual and responsive rules.
- **Main runtime (`js/main.js`)**:
  - DOM caching
  - app state
  - Tone transport + scheduling
  - canvas drawing
  - input handlers and UX notifications
- **Utility modules (`js/modules`)**:
  - `time-utils.js`: `formatTime`, `parseTimeInput`
  - `marks-utils.js`: sorted mark insert + loop segment resolution

## State and Data Flow
1. User loads MIDI -> parse notes/maps -> compute metadata -> enable controls.
2. Playback state from Tone transport drives draw loop and time readouts.
3. Loop marks define loop segments; segment can be toggled and edited via readout inputs.
4. Seek updates transport immediately; heavy refresh is throttled during drag.

## Performance Practices in Current Build
- Lazy audio initialization to avoid unnecessary startup work.
- `seekMarks` kept sorted to avoid repeated sorting in loop/jump paths.
- Seek drag throttling to reduce rebuild pressure.
- Responsive key compression to avoid layout overflow on narrow screens.

# Audio

Sound starts off. Press **M** or enable it in the pause menu.

**Audio settings** has volume controls for master, engine, tires/wind, environment, traffic, and music. Choose Balanced, Scenic, or Night drive as a preset. Balanced has music off. **Soften loud sounds** adds compression. Settings save locally.

Audio is generated with Web Audio. Engine sounds follow the car, speed, and load; traffic uses stereo panning. Pause and focus loss fade and suspend audio.

Code: [src/audio.js](../src/audio.js) and [src/audio/](../src/audio/). Tests run with `npm test`.

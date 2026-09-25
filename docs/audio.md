# Audio

Sound is off by default. Turn it on from the pause menu.

**Audio settings** has volume sliders for master, engine, tires/wind, environment, traffic and music. There are three presets: Balanced, Scenic and Night drive. Balanced has music turned off. **Soften loud sounds** adds compression. Settings are saved locally.

All sounds are generated with the Web Audio API. The engine sound follows the car's speed and load, and traffic is panned in stereo. Audio fades out and suspends when the game is paused or loses focus.

The code is in [src/audio.js](../src/audio.js) and [src/audio/](../src/audio/). Tests run with `npm test`.

# Audio

Sound is off at first. Turn it on from the pause menu. The game remembers the setting for next time. The title screen is always silent. Sound starts when you start a taxi run or free drive.

**Audio settings** has volume sliders for master, engine, tires/wind, environment, traffic and game cues. There are three presets: Balanced, Scenic and Night drive. **Soften loud sounds** adds compression. Settings are saved locally.

All sounds are generated with the Web Audio API. There are no audio files.

- The engine follows the car's speed and load through an automatic gearbox. Each car has its own engine sound. Sporty cars crackle when you lift off the throttle.
- The helicopter has no gears. Its turbine follows the rotor as it speeds up, and the blades beat about 17 times a second.
- Boost, crashes, kerbs and bridge joints each have their own sound.
- Traffic is panned in stereo. Cars idle quietly and get louder as they pull away. A driver you hit or hold up will sound the horn.
- The city sounds different from place to place. Downtown is busier. Parks have birds by day and crickets at night. The harbour has gulls and lapping water.
- Rain, storms and snow change the sound. In first person view the cabin muffles the outside.
- Taxi runs have short cues for pickups, drop-offs, fares and the last ten seconds of the shift. Finding a landmark also plays a cue.

Audio fades out and suspends when the game is paused or loses focus.

The code is in [src/audio.js](../src/audio.js) and [src/audio/](../src/audio/). Tests run with `npm test`.

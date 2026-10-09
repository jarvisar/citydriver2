// Chrome draws the page with Skia on the GPU, and Skia compiles a shader the
// first time it meets each new kind of drawing (a shadow round a rounded box,
// a gradient with hard stops, an SVG outline, a canvas path). That happens on
// the GPU thread that also draws the game, so the first pause, garage, boost
// or drift held up the drive for 20-200 ms. Here copies of those screens are
// drawn once under the loading screen so the compiles happen there instead.
// Chrome keeps the shaders for the visit (and on disk for later ones).
//
// The copies go straight into #app, between the canvas and the loading screen
// (z-index 8). Under the canvas Chrome would skip them: it doesn't raster what
// an opaque layer covers. They are clones, so the page's own elements, focus
// and listeners are untouched, and anything hidden inside them is shown.

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

export async function warmInterface(app, scenes, { frames = 1 } = {}) {
  const placed = [];
  const show = async () => { for (let i = 0; i < frames; i++) await nextFrame(); };
  // A dialog is laid out as showModal would
  function copy(element, { dialog = false } = {}) {
    const clone = element.cloneNode(true);
    for (const hidden of [clone, ...clone.querySelectorAll('[hidden]')]) hidden.hidden = false;
    clone.inert = true; clone.setAttribute('aria-hidden', 'true');
    clone.style.zIndex = '7'; clone.style.pointerEvents = 'none';
    if (dialog) { clone.setAttribute('open', ''); Object.assign(clone.style, { position: 'fixed', inset: '0', margin: 'auto', overflow: 'auto' }); }
    app.append(clone); placed.push(clone);
    return clone;
  }
  // The HUD's and menus' styles follow the title menu, so it is put away
  // meanwhile (without its fade) and they apply as in a drive.
  const welcome = app.querySelector('#welcome'), titled = !welcome.classList.contains('hidden');
  welcome.style.transition = 'none'; welcome.classList.add('hidden');
  try {
    for (const scene of scenes) {
      await scene({ copy, show });
      for (const clone of placed.splice(0)) clone.remove();
    }
  } finally {
    for (const clone of placed) clone.remove();
    welcome.classList.toggle('hidden', !titled);
    getComputedStyle(welcome).opacity;
    welcome.style.transition = '';
  }
}

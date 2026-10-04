// The loading screen's line of progress: what is being built now. Each stage
// of the city is shown before it begins, and the page is given a frame to
// draw it (the build itself allows none). Outside a page, the tests and
// scripts, the stages simply run on.
export const LOADING_STAGES = {
  coast: 'Generating coastline…', streets: 'Generating streets…', junctions: 'Generating junctions…',
  waterfront: 'Generating waterfront…', pavements: 'Generating lots…',
  bridges: 'Generating bridges…', furniture: 'Placing street props…', buildings: 'Generating buildings…',
  skyline: 'Loading skyline…', graphics: 'Compiling shaders…',
};

export function startupErrorMessage(error) {
  return /Error creating WebGL context|WebGL 1 is not supported/i.test(error?.message ?? '')
    ? 'WebGL 2 required. Update your browser and enable hardware acceleration.'
    : 'The game could not finish loading. Select Try again to reload.';
}

export function loadingStage(stage) {
  const line = globalThis.document?.getElementById('loading-status');
  if (!line) return Promise.resolve();
  line.textContent = LOADING_STAGES[stage] ?? line.textContent;
  // (a frame drawn, or a moment if the page is hidden and draws none)
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 100);
    if (!document.hidden) requestAnimationFrame(() => setTimeout(() => { clearTimeout(timer); resolve(); }));
  });
}

// A staged build (a generator yielding each stage as it begins) run to its
// end, each stage shown on the loading screen
export async function throughStages(stages) {
  for (;;) {
    const { done, value } = stages.next();
    if (done) return value;
    await loadingStage(value);
  }
}

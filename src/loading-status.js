// The loading screen's line of progress: what is being built now. Each stage
// of the city is shown before it begins, and the page is given a frame to
// draw it (the build itself allows none). Outside a page, the tests and
// scripts, the stages simply run on.
export const LOADING_STAGES = {
  coast: 'Charting the coast…', streets: 'Tracing the streets…', junctions: 'Joining up the junctions…',
  waterfront: 'Shaping the waterfront…', pavements: 'Laying out lots and pavements…',
  bridges: 'Building the bridges…', furniture: 'Furnishing the streets…', buildings: 'Raising the buildings…',
  skyline: 'Filling in the skyline…', graphics: 'Warming up the graphics…',
};

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

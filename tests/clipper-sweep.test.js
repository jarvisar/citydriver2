import test from 'node:test';
import assert from 'node:assert/strict';
import ClipperLib from 'clipper-lib';

// booleans.js replaces three methods of Clipper's sweep with quicker ones
// (src/mapgen/clipper-sweep.js). Every city is cut from their results, so
// they must be the library's own, point for point.

// The library's methods, kept from before the city is built, and every
// boolean its build runs
const sweep = ClipperLib.Clipper.prototype, METHODS = ['ExecuteInternal', 'BuildIntersectList', 'ProcessEdgesAtTopOfScanbeam'];
const library = Object.fromEntries(METHODS.map(name => [name, sweep[name]]));
const jobs = [], added = new WeakMap(), { AddPath, Execute } = sweep;
sweep.AddPath = function (path, type, closed) {
  if (!added.has(this)) added.set(this, []);
  added.get(this).push([path.map(p => ({ X: p.X, Y: p.Y })), type, closed]);
  return AddPath.call(this, path, type, closed);
};
sweep.Execute = function (type, solution, subjectFill, clipFill) {
  jobs.push({ paths: added.get(this) ?? [], strict: this.StrictlySimple, type, tree: solution instanceof ClipperLib.PolyTree, fills: [subjectFill, clipFill] });
  return Execute.call(this, type, solution, subjectFill, clipFill);
};
await import('../src/world/city.js');
Object.assign(sweep, { AddPath, Execute });
const quickened = Object.fromEntries(METHODS.map(name => [name, sweep[name]]));

function solve(job, methods) {
  Object.assign(sweep, methods);
  const clipper = new ClipperLib.Clipper(), solution = job.tree ? new ClipperLib.PolyTree() : [];
  clipper.StrictlySimple = job.strict;
  for (const [path, type, closed] of job.paths) clipper.AddPath(path, type, closed);
  const done = clipper.Execute(job.type, solution, ...job.fills);
  // (a tree by its outlines, each with whether it is a hole and its children)
  const outline = node => [node.IsHole(), node.Contour().map(p => [p.X, p.Y]), node.Childs().map(outline)];
  return [done, job.tree ? solution.Childs().map(outline) : solution.map(path => path.map(p => [p.X, p.Y]))];
}

test('the quickened sweep gives the library\'s result for every boolean of a city\'s build', () => {
  for (const name of METHODS) assert.notEqual(quickened[name], library[name], `${name} is replaced`);
  assert.ok(jobs.length > 1000 && jobs.some(job => job.strict) && jobs.some(job => !job.tree), 'plain, strict and offset booleans were all run');
  try {
    jobs.forEach((job, i) => assert.deepEqual(solve(job, quickened), solve(job, library), `boolean ${i} of ${jobs.length}`));
  } finally { Object.assign(sweep, quickened); }
});

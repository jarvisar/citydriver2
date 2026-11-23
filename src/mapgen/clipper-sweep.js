// Clipper sweeps a boolean scanbeam by scanbeam, and at each one goes over
// every edge crossing it several times, though all but a few only pass
// through. Three of its methods are replaced here by the same steps with
// less work in them. The results are the library's own, point for point
// (tests/clipper-sweep.test.js runs a city's booleans both ways), in about
// half the time. They are written against one version of the library, and
// left alone for any other.
export function quickenSweep(ClipperLib) {
  if (ClipperLib.version !== '6.4.2.2' || ClipperLib.use_xyz) return;
  const sweep = ClipperLib.Clipper.prototype, { IntPoint0, IntPoint1, IntersectNode } = ClipperLib;
  const topX = ClipperLib.Clipper.TopX, round = ClipperLib.Clipper.Round;
  const isHorizontal = ClipperLib.ClipperBase.IsHorizontal, slopesEqual = ClipperLib.ClipperBase.SlopesEqual5;

  // (The library emptied the ghost joins before every scanbeam, a slow call
  // even on a list that is nearly always empty.)
  sweep.ExecuteInternal = function () {
    try {
      this.Reset();
      this.m_SortedEdges = null; this.m_Maxima = null;
      const botY = {}, topY = {};
      if (!this.PopScanbeam(botY)) return false;
      this.InsertLocalMinimaIntoAEL(botY.v);
      while (this.PopScanbeam(topY) || this.LocalMinimaPending()) {
        this.ProcessHorizontals();
        if (this.m_GhostJoins.length) this.m_GhostJoins.length = 0;
        if (!this.ProcessIntersections(topY.v)) return false;
        this.ProcessEdgesAtTopOfScanbeam(topY.v);
        botY.v = topY.v;
        this.InsertLocalMinimaIntoAEL(botY.v);
      }
      for (let i = 0, n = this.m_PolyOuts.length; i < n; i++) {
        const outRec = this.m_PolyOuts[i];
        if (outRec.Pts === null || outRec.IsOpen) continue;
        if ((outRec.IsHole ^ this.ReverseSolution) == (this.Area$1(outRec) > 0)) this.ReversePolyPtLinks(outRec.Pts);
      }
      this.JoinCommonEdges();
      for (let i = 0, n = this.m_PolyOuts.length; i < n; i++) {
        const outRec = this.m_PolyOuts[i];
        if (outRec.Pts === null) continue;
        if (outRec.IsOpen) this.FixupOutPolyline(outRec); else this.FixupOutPolygon(outRec);
      }
      if (this.StrictlySimple) this.DoSimplePolygons();
      return true;
    } finally { this.m_Joins.length = 0; this.m_GhostJoins.length = 0; }
  };

  // Where each edge crosses the scanbeam's top, and the crossings between
  // edges that change places below it. (The library made a point for every
  // pair of neighbors it compared, and went over edges already in order a
  // second time, to find nothing.)
  sweep.BuildIntersectList = function (topY) {
    let e = this.m_ActiveEdges;
    if (e === null) return;
    this.m_SortedEdges = e;
    let ordered = true, before = -Infinity, last = e;
    while (e !== null) {
      e.PrevInSEL = e.PrevInAEL; e.NextInSEL = e.NextInAEL;
      const top = e.Top, bot = e.Bot, x = e.Curr.X = top.Y === topY ? top.X : bot.X + round(e.Dx * (topY - bot.Y));
      if (x < before) ordered = false;
      before = x; last = e; e = e.NextInAEL;
    }
    // (the sort's one pass over edges in order only cuts the last off the list)
    if (ordered) { if (last.PrevInSEL !== null) last.PrevInSEL.NextInSEL = null; this.m_SortedEdges = null; return; }
    const pt = new IntPoint0();
    let swapped = true;
    while (swapped && this.m_SortedEdges !== null) {
      swapped = false;
      e = this.m_SortedEdges;
      while (e.NextInSEL !== null) {
        const next = e.NextInSEL;
        if (e.Curr.X > next.Curr.X) {
          this.IntersectPoint(e, next, pt);
          if (pt.Y < topY) { pt.X = topX(e, topY); pt.Y = topY; }
          const node = new IntersectNode();
          node.Edge1 = e; node.Edge2 = next; node.Pt.X = pt.X; node.Pt.Y = pt.Y;
          this.m_IntersectList.push(node);
          this.SwapPositionsInSEL(e, next);
          swapped = true;
        } else e = next;
      }
      if (e.PrevInSEL !== null) e.PrevInSEL.NextInSEL = null; else break;
    }
    this.m_SortedEdges = null;
  };

  // (with StrictlySimple, two edges of the solution that touch at a
  // scanbeam's top each get a vertex there)
  const touch = (clipper, e) => {
    const prev = e.PrevInAEL;
    if (e.OutIdx >= 0 && e.WindDelta !== 0 && prev !== null && prev.OutIdx >= 0 && prev.Curr.X === e.Curr.X && prev.WindDelta !== 0) {
      const ip = new IntPoint1(e.Curr), op = clipper.AddOutPt(prev, ip), op2 = clipper.AddOutPt(e, ip);
      clipper.AddJoin(op, op2, ip);
    }
  };
  // (whether a promoted edge and its neighbor in the solution run along one line from here)
  const shares = (e, other, op, fullRange) => other !== null && other.Curr.X === e.Bot.X && other.Curr.Y === e.Bot.Y && op !== null && other.OutIdx >= 0
    && other.Curr.Y === other.Top.Y && slopesEqual(e.Curr, e.Top, other.Curr, other.Top, fullRange) && e.WindDelta !== 0 && other.WindDelta !== 0;
  sweep.ProcessEdgesAtTopOfScanbeam = function (topY) {
    const strict = this.StrictlySimple;
    let e = this.m_ActiveEdges;
    while (e !== null) {
      // An edge passing through: BuildIntersectList has just stored where it
      // crosses this height, and nothing moves an edge between there and
      // here. (The library worked it out again.)
      if (e.Top.Y !== topY) {
        e.Curr.Y = topY;
        if (strict) touch(this, e);
        e = e.NextInAEL;
        continue;
      }
      // An edge ending here: a maximum, unless its pair is horizontal
      let maximum = e.NextInLML === null;
      if (maximum) { const pair = this.GetMaximaPairEx(e); maximum = pair === null || !isHorizontal(pair); }
      if (maximum) {
        if (strict) this.InsertMaxima(e.Top.X);
        const prev = e.PrevInAEL;
        this.DoMaxima(e);
        e = prev === null ? this.m_ActiveEdges : prev.NextInAEL;
        continue;
      }
      // or one carrying on, a horizontal next promoted now
      if (e.NextInLML !== null && isHorizontal(e.NextInLML)) {
        e = this.UpdateEdgeIntoAEL(e);
        if (e.OutIdx >= 0) this.AddOutPt(e, e.Bot);
        this.AddEdgeToSEL(e);
      } else { e.Curr.X = topX(e, topY); e.Curr.Y = topY; }
      if (strict) touch(this, e);
      e = e.NextInAEL;
    }
    this.ProcessHorizontals();
    this.m_Maxima = null;
    // The rest that carry on are promoted, joined to a neighbor whose edge
    // they share
    e = this.m_ActiveEdges;
    while (e !== null) {
      if (e.Top.Y === topY && e.NextInLML !== null) {
        const op = e.OutIdx >= 0 ? this.AddOutPt(e, e.Top) : null;
        e = this.UpdateEdgeIntoAEL(e);
        // (the library's own slip: for the edge before, it names one it never declared)
        if (shares(e, e.PrevInAEL, op, this.m_UseFullRange)) throw new ReferenceError('ePrev2 is not defined');
        const next = e.NextInAEL;
        if (shares(e, next, op, this.m_UseFullRange)) this.AddJoin(op, this.AddOutPt(next, e.Bot), e.Top);
      }
      e = e.NextInAEL;
    }
  };
}

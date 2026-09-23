// The graphics controller supplies the detail budget. The city maps High to
// a radius of three detailed blocks, Balanced/Smooth to two, and Basic to one.
// The immediate 3 x 3 collision neighborhood is complete at every level; a
// distant ring keeps the horizon filled at every level.
const DEFAULT = { behind: 3, ahead: 5 };
let resident = DEFAULT;
export const residentWindow = () => resident;
export function setResidentWindow({ behind, ahead } = DEFAULT) {
  resident = { behind, ahead };
}

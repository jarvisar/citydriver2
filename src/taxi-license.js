// End-of-shift taxi licences, after Crazy Taxi's results screen. Each class
// asks for twice the cash of the one before, which tracks how earnings grow
// with skill: a first shift lands around Class E, a strong one in Class A,
// and only a shift that keeps its clock alive for many minutes reaches the top.
export const TAXI_LICENSES = [
  { id: 'none', badge: '–', name: 'No license', min: 0 },
  { id: 'e', badge: 'E', name: 'Class E', min: 250 },
  { id: 'd', badge: 'D', name: 'Class D', min: 500 },
  { id: 'c', badge: 'C', name: 'Class C', min: 1000 },
  { id: 'b', badge: 'B', name: 'Class B', min: 2000 },
  { id: 'a', badge: 'A', name: 'Class A', min: 4000 },
  { id: 's', badge: 'S', name: 'Class S', min: 8000 },
  { id: 'legend', badge: '★', name: 'Legend', min: 16000 },
];

export function taxiLicense(cash = 0) {
  const rank = TAXI_LICENSES.findLastIndex(license => cash >= license.min);
  return { ...TAXI_LICENSES[rank], rank, next: TAXI_LICENSES[rank + 1] ?? null };
}

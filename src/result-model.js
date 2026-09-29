import { taxiLicense } from './taxi-license.js';
import { demolitionRank, money as damageMoney } from './demolition-run.js';

const money = value => `$${Math.round(value ?? 0).toLocaleString('en-US')}`;

export function taxiResultModel(run, found = []) {
  const license = taxiLicense(run.cash), best = taxiLicense(run.best);
  const improved = run.cash > 0 && license.rank > taxiLicense(run.previousBest).rank;
  return { cash: money(run.cash), license, name: license.id === 'none' ? license.name : `${license.name} license`,
    next: [improved && 'New best license!', license.next ? `${money(license.next.min - run.cash)} more for ${license.next.name}` : 'The top license'].filter(Boolean).join(' · '),
    best: [`Best ${money(run.best)} · ${best.name}`, found.length && `${found.length} new ${found.length > 1 ? 'places' : 'place'} found`].filter(Boolean).join(' · ') };
}

export function demolitionResultModel(run) {
  const rank = demolitionRank(run.score), improved = run.score > 0 && rank.rank > demolitionRank(run.previousBest).rank;
  return { cash: damageMoney(run.score), rank, name: rank.name,
    next: [run.summary?.best ? 'New high score!' : improved && 'Best rating yet!',
      rank.next ? `${damageMoney(rank.next.min - Math.max(0, run.score))} more for ${rank.next.name}` : 'The top rating'].filter(Boolean).join(' · ') };
}

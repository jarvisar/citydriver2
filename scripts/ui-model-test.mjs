// Shared menu commands and HUD data through the real page, including a page
// whose labels, attributes and styles no longer describe the game at all.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 0, host: '127.0.0.1', watch: null, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
    : process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [], page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(90000);
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('citydriver.graphics', JSON.stringify({ mode: 'basic', ambientOcclusion: false })));
try {
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?seed=4817&ao=0`);
  await page.waitForFunction(() => window.__citydriver && !window.__citydriver.changingJourney);
  await page.click('#free-drive'); await page.click('#pause');
  assert.equal(await page.evaluate(() => window.__citydriver.currentMenuModel().id), 'pause');
  const checks = await page.evaluate(async () => {
    const game = window.__citydriver, { headsetHudModel } = await import('/src/run-hud-model.js');
    const failures = [], check = (ok, text) => { if (!ok) failures.push(text); };
    const closed = id => new Promise(resolve => document.getElementById(id).addEventListener('close', resolve, { once: true }));
    const readModel = () => {
      const methods = ['querySelector', 'querySelectorAll', 'getElementById'], originals = methods.map(name => document[name]);
      for (const name of methods) document[name] = () => { throw new Error(`Menu model queried the page: ${name}`); };
      try { return game.currentMenuModel(); } finally { methods.forEach((name, index) => { document[name] = originals[index]; }); }
    };
    const row = id => {
      const model = readModel(), item = model?.items.find(item => item.id === id);
      if (!item) throw new Error(`Missing ${id} in ${model?.id}, paused=${game.paused}, mode=${game.gameMode}: ${failures.join(', ')}`);
      return item;
    };
    const nativeClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = () => { throw new Error('A menu command called a desktop button'); };
    try {
      const traffic = game.traffic.enabled;
      document.querySelector('#traffic').setAttribute('aria-pressed', String(!traffic));
      check(row('traffic').toggle === traffic, 'traffic reads the simulation');
      await row('traffic').activate(); check(game.traffic.enabled !== traffic, 'traffic command works');
      document.querySelector('#sound').setAttribute('aria-pressed', String(!game.audio.enabled));
      check(row('sound').toggle === game.audio.enabled, 'sound reads the audio state');
      const select = document.querySelector('#city-weather');
      select.innerHTML = '<option value="nonsense">Changed label</option>';
      game.weather.setMode('sunset'); check(row('weather').value === 'Golden hour', 'weather has its own choice labels');
      await row('weather').activate(); check(game.weather.mode === 'night', 'weather cycling ignores the desktop options');
      document.querySelector('#distance').textContent = 'Wrong distance';
      check(!game.currentMenuModel().subtitle.includes('Wrong'), 'pause mileage comes from the vehicle');
      await row('garage').activate();
      const garage = game.currentMenuModel(), paints = garage.items.filter(item => item.group === 'Paint');
      for (const button of document.querySelectorAll('[data-paint], [data-car]')) {
        button.setAttribute('aria-label', 'Wrong'); button.setAttribute('aria-current', 'true'); button.disabled = true;
      }
      check(game.currentMenuModel().items.some(item => item.id === 'sports' && item.label === 'GT'), 'garage labels come from car data');
      // (a colour costs money: give the save one coat's worth)
      const unpainted = game.taxi.fleet.balance; game.taxi.fleet.credit(100);
      game.currentMenuModel().items.filter(item => item.group === 'Paint')[1].activate();
      check(game.paint === paints[1].id && game.taxi.fleet.balance === unpainted, 'paint command applies without a click, and is paid for');
      // A car the fleet doesn't own opens its offer, and Back returns to the cards
      game.currentMenuModel().items.find(item => item.group === 'Cars' && item.id === 'sports').activate();
      check(game.currentMenuModel().id === 'car-offer' && game.currentMenuModel().title === 'GT', 'an unowned car opens its offer');
      check(game.currentMenuModel().items.find(item => item.id === 'offer-buy').disabled, 'it can\'t be bought without the money');
      game.currentMenuModel().items.find(item => item.label === 'Back').activate();
      check(game.currentMenuModel().id === 'car-dialog', 'back to the garage from an offer');
      game.taxi.fleet.credit(12000);
      game.currentMenuModel().items.find(item => item.id === 'sports').activate();
      const bought = closed('car-dialog');
      game.currentMenuModel().items.find(item => item.id === 'offer-buy').activate();
      await bought;
      check(game.carId === 'sports' && game.taxi.fleet.owned.has('sports') && game.taxi.fleet.balance === 0, 'buying a car puts the player in it');
      check(!game.paused, 'a car just bought goes straight to the drive');
      await game.action('pause'); await row('garage').activate();
      const garageClosed = closed('car-dialog');
      game.currentMenuModel().items.find(item => item.id === 'taxi').activate();
      check(game.carId === 'taxi', 'car command applies without a click');
      await garageClosed;
      check(game.paused && game.currentMenuModel().id === 'pause', 'picking a car restores the pause menu');
      await row('taxi').activate(); await game.action('pause'); await row('fleet').activate();
      game.taxi.fleet.credit(10000);
      document.querySelector('#fleet-balance').textContent = '$999999';
      const cab = game.currentMenuModel().items.find(item => item.id === 'taxiGT');
      document.querySelector('[data-fleet-car="taxiGT"]').disabled = true;
      check(!cab.disabled && !game.currentMenuModel().subtitle.includes('999999'), 'fleet state ignores desktop balance and disabled buttons');
      cab.activate(); check(game.taxi.fleet.balance === 0 && game.taxi.fleet.selected === 'taxiGT', 'fleet command buys the cab');
      check(game.vehicle.carId === 'taxi', 'purchases still apply next run');
      const fleetClosed = closed('taxi-fleet-dialog'); await row('back').activate(); await fleetClosed;
      check(game.paused && game.currentMenuModel().id === 'pause', 'fleet restores pause');
      // The shift starts with its first fare: the cab stopped in a ring
      const fare = game.taxi.customers.find(customer => customer.id !== game.taxi.blockedPickup?.id);
      Object.assign(game.vehicle, { s: fare.s, u: fare.u, heading: fare.heading, speed: 0 }); game.vehicle.update(0, {});
      await row('resume').activate();
      while (!game.taxi.running) await new Promise(requestAnimationFrame);
      await game.action('pause');
      check(game.gameMode === 'taxi' && row('end').label === 'End shift', 'the first fare starts the shift');
      // A rendered HUD is not the input to either the next HUD or the headset.
      const model = game.taxiView.hud(game.taxi, game.vehicle), before = headsetHudModel(model);
      document.querySelector('#taxi-cash').textContent = 'Wrong cash';
      document.querySelector('#taxi-task-title').textContent = 'Wrong title';
      document.querySelector('#taxi-timer').hidden = false;
      document.querySelector('#taxi-timer-fill').style.width = '99%';
      check(JSON.stringify(headsetHudModel(model)) === JSON.stringify(before), 'HUD ignores desktop corruption');
      await row('demolition').activate(); await game.action('pause');
      const demolition = game.demolitionView.hud(game.demolition, game.vehicle);
      check(demolition.timer.fraction === null && headsetHudModel(demolition).timer.fraction === null, 'contracts have no timer bar');
      await row('resume').activate(); game.demolition.timeLeft = .001;
      while (game.demolition.status !== 'over') await new Promise(requestAnimationFrame);
      document.querySelector('#demolition-result-score').textContent = 'Wrong score';
      document.querySelector('#demolition-rank-name').textContent = 'Wrong rank';
      check(game.currentMenuModel().id === 'demolition-results' && !JSON.stringify(game.currentMenuModel()).includes('Wrong'), 'results come from the completed run');
    } finally { HTMLElement.prototype.click = nativeClick; }
    return failures;
  });
  assert.deepEqual(checks, []);
  assert.deepEqual(errors, []);
  console.log('Shared menu commands, chooser transitions, HUD and results are independent of desktop text, attributes, styles and clicks.');
} finally { await browser.close(); await server.close(); }

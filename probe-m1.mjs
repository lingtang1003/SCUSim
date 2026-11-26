import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './src/config/loader.js';
import { newGame, doAction, advance, actionAvailability } from './src/core/engine.js';
import { createRng } from './src/core/rng.js';

const config = await loadConfig({ read: (p) => readFile(join('config', p + '.json'), 'utf8') });
const validOptions = {
  name: '验证员', gender: '男', collegeId: 'cs',
  attributes: { knowledge: 5, social: 5, health: 5, money: 5 },
  tags: ['study_hard', 'gamer', 'chill'],
  seed: 2024,
};
const r = createRng(31337);
const ng = newGame(validOptions, config, r);
const s = ng.state;
let guard = 0;
let lastAdv = null;
while (s.turn < 40 && !s.endingId && guard < 500) {
  guard++;
  let inner = 0;
  while (s.actionPoints > 0 && inner < 100) {
    inner++;
    const av = config.actions.list.find((a) => actionAvailability(s, a.id, config).ok);
    if (!av) break;
    const dr = doAction(s, av.id, config, r);
    if (!dr.ok) break;
  }
  if (s.turn >= 40 || s.endingId) break;
  const ad = advance(s, config, r);
  lastAdv = ad;
  if (!ad.ok) { console.log('advance not ok at turn', s.turn, ad.reason); break; }
}
console.log({ turn: s.turn, endingId: s.endingId, pending: s.pendingEvent && s.pendingEvent.eventId, guard, lastAdvOk: lastAdv && lastAdv.ok });
console.log('lastAdv keys:', lastAdv ? Object.keys(lastAdv) : null);
console.log('attrs:', s.player.attributes, 'gpa:', s.academics.totalGpa, 'failed:', s.academics.failedCourses);

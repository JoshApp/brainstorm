/**
 * Balance report — prints a combat dashboard straight from the LIVE data
 * (items, weapon classes, enemies, config, hurtbox zones) so the numbers never
 * drift as you tune. Run:
 *
 *   npm run balance
 *
 * Sections:
 *   1. WEAPONS — range, cone/cleave, per-hit damage (light / heavy / max, by
 *      zone + crit), and DPS (light / combo / heavy).
 *   2. MONSTERS — base HP, depth-scaled HP, and time-to-kill vs reference weapons.
 *
 * Damage model (mirrors src/combat/attack.ts):
 *   hit = base × stepMul × charge × zoneMul × critMul
 *   - light  = uncharged tap (charge 1.0)
 *   - heavy  = full charge (×1.8 = 1 + HEAVY_CHARGE_BONUS)
 *   - head   = ROLE_DEFAULT_MUL.head ; crit chance +ROLE_DEFAULT_CRITBONUS.head
 *   - max    = heavy × head × critMul × perfect-overcharge (× execute on staggered)
 * DPS uses the class's combo step timings (windup+strike+recover).
 */
import { ITEMS } from '../src/content/items';
import { ENEMIES } from '../src/content/enemies';
import { WEAPON_CLASS_DEFAULTS } from '../src/content/weapon-classes';
import type { ComboStep } from '../src/content/weapon-classes';
import { scaleEnemySpec } from '../src/content/modifiers';
import { ROLE_DEFAULT_MUL, ROLE_DEFAULT_CRITBONUS } from '../src/combat/hurtbox';
import { CONFIG } from '../src/config';

const HEAVY_CHARGE_BONUS = 0.80;        // attack.ts: chargeMul = 1 + c*0.80 (mirror)
const HEAVY_MUL = 1 + HEAVY_CHARGE_BONUS;
const CHARGE_TIME_S = 0.55;             // config CHARGE comment: hold-to-full ≈ 0.55s
const HEAD_MUL = ROLE_DEFAULT_MUL.head;
const HEAD_CRITBONUS = ROLE_DEFAULT_CRITBONUS.head;
const PERFECT = CONFIG.CHARGE.PERFECT_DAMAGE_MUL;
const EXECUTE = CONFIG.EXECUTE.DAMAGE_MUL;
const REF_DEPTHS = [1, 5, 10];

const r1 = (n: number) => n.toFixed(1);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

interface Wpn {
  id: string; name: string; cls: string;
  dmg: number; critC: number; critM: number;
  reach: number | null; coneDeg: number; cleave: number;
  ranged: boolean;
}

function weapons(): Wpn[] {
  const out: Wpn[] = [];
  for (const [id, item] of Object.entries(ITEMS)) {
    const w = item.weapon;
    if (!w) continue;
    const combo = WEAPON_CLASS_DEFAULTS[w.class]?.combo ?? [];
    const cleave = combo.reduce((m, s) => Math.max(m, s.maxTargets ?? 1), 1);
    const ranged = w.reach != null && w.reach >= 8;
    out.push({
      id, name: item.name, cls: w.class,
      dmg: w.damage, critC: w.critChance ?? 0, critM: w.critMultiplier ?? 1,
      reach: w.reach ?? null,
      coneDeg: Math.round((w.coneHalfAngle ?? 0) * 2 * 180 / Math.PI),
      cleave, ranged,
    });
  }
  return out;
}

// Effective damage fraction of a combo step (flurry = count × per-hit frac).
function stepMul(s: ComboStep): number {
  return s.hits ? s.hits.count * s.hits.damageMul : (s.damageMul ?? 1);
}
function stepTime(s: ComboStep): number {
  return s.windup + s.strike + s.recover;
}

// Expected per-hit damage factoring crit chance (body hit, uncharged).
function expected(w: Wpn): number {
  return w.dmg * (1 + w.critC * (w.critM - 1));
}

function comboDps(w: Wpn): { combo: number; light: number; heavy: number } {
  const combo = WEAPON_CLASS_DEFAULTS[w.cls]?.combo ?? [];
  if (!combo.length) {
    // Ranged / classes with no melee chain — one shot per (strike+recover-ish).
    const t = 0.4;
    return { combo: expected(w) / t, light: expected(w) / t, heavy: 0 };
  }
  const critFactor = 1 + w.critC * (w.critM - 1);
  let dmg = 0, time = 0;
  for (const s of combo) { dmg += w.dmg * stepMul(s) * critFactor; time += stepTime(s); }
  const combodps = dmg / time;
  const s0 = combo[0];
  const light = (w.dmg * stepMul(s0) * critFactor) / stepTime(s0);
  // Ranged can't charge → no heavy DPS.
  const heavy = w.ranged ? 0 : (w.dmg * HEAVY_MUL * critFactor) / (CHARGE_TIME_S + s0.strike + s0.recover);
  return { combo: combodps, light, heavy };
}

console.log('\n========================  WEAPONS  ========================\n');
console.log(
  pad('weapon', 22) + pad('class', 9) + padL('dmg', 4) + padL('crit', 8) +
  padL('range', 7) + padL('cone', 6) + padL('cleave', 7),
);
console.log('-'.repeat(63));
const ws = weapons();
for (const w of ws) {
  console.log(
    pad(w.name.slice(0, 21), 22) + pad(w.cls, 9) + padL(w.dmg, 4) +
    padL(`${Math.round(w.critC * 100)}%×${w.critM}`, 8) +
    padL(w.reach != null ? r1(w.reach) : 'melee', 7) +
    padL(`${w.coneDeg}°`, 6) + padL(w.cleave, 7),
  );
}

console.log('\n----------------  PER-HIT DAMAGE (body / head / +crit)  ----------------\n');
console.log(
  pad('weapon', 22) + padL('L body', 8) + padL('L head', 8) + padL('L crit', 8) +
  padL('H body', 8) + padL('H crit', 8) + padL('MAX', 8),
);
console.log('-'.repeat(70));
for (const w of ws) {
  const lBody = w.dmg;
  const lHead = w.dmg * HEAD_MUL;
  const lCrit = w.dmg * w.critM;
  // Ranged FIRES — no charge, so no heavy/execute. Its ceiling is a head crit.
  const hBody = w.ranged ? null : w.dmg * HEAVY_MUL;
  const hCrit = w.ranged ? null : w.dmg * HEAVY_MUL * w.critM;
  const max = w.ranged
    ? w.dmg * HEAD_MUL * w.critM                                   // head crit
    : w.dmg * HEAVY_MUL * HEAD_MUL * w.critM * PERFECT * EXECUTE;  // heavy head crit overcharge execute
  console.log(
    pad(w.name.slice(0, 21), 22) + padL(r1(lBody), 8) + padL(r1(lHead), 8) +
    padL(w.critM > 1 ? r1(lCrit) : '—', 8) + padL(hBody != null ? r1(hBody) : '—', 8) +
    padL(hCrit != null && w.critM > 1 ? r1(hCrit) : '—', 8) + padL(r1(max), 8),
  );
}
console.log('\nMAX = heavy ×1.8 · head ×' + HEAD_MUL + ' · crit · overcharge ×' + PERFECT + ' · execute ×' + EXECUTE + ' (staggered foe)');

console.log('\n----------------  DPS (expected, incl. crit chance)  ----------------\n');
console.log(pad('weapon', 22) + padL('light', 8) + padL('combo', 8) + padL('heavy', 8));
console.log('-'.repeat(46));
for (const w of ws) {
  const d = comboDps(w);
  console.log(
    pad(w.name.slice(0, 21), 22) + padL(r1(d.light), 8) + padL(r1(d.combo), 8) +
    padL(d.heavy ? r1(d.heavy) : '—', 8),
  );
}
console.log('\nlight = step-0 spam · combo = full chain · heavy = full-charge / (≈' + CHARGE_TIME_S + 's + strike + recover)');

// ----------------------------  MONSTERS  ----------------------------
console.log('\n\n========================  MONSTERS  ========================\n');

// Reference weapons for TTK: the starter + a strong mid sword.
const refStarter = ws.find((w) => w.id === 'rusted-sword');
const refMid = ws.find((w) => w.id === 'heartburn') ?? ws.find((w) => w.dmg >= 3);
const refStarterDps = refStarter ? comboDps(refStarter).combo : 1;
const refMidDps = refMid ? comboDps(refMid).combo : 1;

console.log(
  pad('enemy', 20) + padL('base', 6) +
  REF_DEPTHS.map((d) => padL(`hp@D${d}`, 8)).join('') +
  padL('TTK·start', 11) + padL('TTK·mid', 10),
);
console.log('-'.repeat(20 + 6 + REF_DEPTHS.length * 8 + 21));

// Sort by base HP so the roster reads trash → boss.
const mobs = Object.values(ENEMIES)
  .filter((e) => (e.hp ?? 0) > 0)
  .sort((a, b) => (a.hp ?? 0) - (b.hp ?? 0));

for (const e of mobs) {
  const base = e.hp ?? 0;
  const hpAt = REF_DEPTHS.map((d) => scaleEnemySpec(e, d).hp);
  // TTK at D1 vs the two reference weapons (combo DPS).
  const ttkS = base / refStarterDps;
  const ttkM = base / refMidDps;
  console.log(
    pad(e.id.slice(0, 19), 20) + padL(base, 6) +
    hpAt.map((h) => padL(h, 8)).join('') +
    padL(`${r1(ttkS)}s`, 11) + padL(`${r1(ttkM)}s`, 10),
  );
}
console.log(
  `\nTTK = base HP / combo DPS · start = ${refStarter?.name ?? '?'} (${r1(refStarterDps)} dps)` +
  ` · mid = ${refMid?.name ?? '?'} (${r1(refMidDps)} dps)`,
);
console.log('HP scaling: ceil(base × (1 + (depth−1)×0.15)). Notes: dagger flurries hit 3×; hammer cannot crit;');
console.log('TTK is body-hit combo DPS — headshots/heavies/executes kill faster. Uses CLASS combos (ignores per-weapon comboTuning).\n');

// Bench entry — the standalone asset editor. Loaded by bench.html, which is
// NOT part of the production build input, so this whole tree only exists on the
// dev server (and never ships to the live site). No game imports: just Three +
// the content builders + the studio.
//
//   /brainstorm/bench.html                     → picker (browse all subjects)
//   /brainstorm/bench.html?subject=mob-ghoul   → hero shot of the ghoul model
//   ?subject=...&grid=12                        → 12-angle turntable contact sheet
//   ?subject=...&az=35&el=18                    → explicit azimuth/elevation
//
// The headless CLI (scripts/bench.ts) drives the same page via window.__bench.

import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { mountStudio } from './studio';
import { resolveSubject, listSubjects } from './subjects';
import { computeReadout, type Readout } from './readout';
import { makeMobAnimator, type SubjectAnimator } from './animate';

const canvas = document.getElementById('bench') as HTMLCanvasElement;

interface BenchApi {
  ready: boolean;
  view(az: number, el: number): void;
  turntable(n: number, el: number): void;
  /** Render the subject's animation arc (mob telegraph) as a contact sheet. */
  anim(n: number, el: number): void;
  readout(): Readout | null;
  subjects(): string[];
}
declare global {
  interface Window { __bench: BenchApi; }
}

const params = new URLSearchParams(location.search);
const subjectId = params.get('subject');

if (!subjectId) {
  renderPicker();
  window.__bench = {
    ready: true,
    view() {}, turntable() {}, anim() {},
    readout: () => null,
    subjects: () => listSubjects().map((a) => a.scenario),
  };
} else {
  const subject = resolveSubject(subjectId);
  const studio = mountStudio(canvas);

  if (!subject) {
    document.body.insertAdjacentHTML('beforeend',
      `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#c66;font:14px monospace">unknown subject: ${subjectId}</div>`);
    window.__bench = { ready: true, view() {}, turntable() {}, anim() {}, readout: () => null, subjects: () => [] };
  } else {
    const built = buildModel(subject.spec);
    // Wrap the model so the studio's recentering (on the holder) doesn't fight
    // a telegraph's vertical bob (on built.group.position.y).
    const holder = new THREE.Group();
    holder.add(built.group);
    studio.show(holder);

    const animator: SubjectAnimator | null = subject.enemy ? makeMobAnimator(built, subject.enemy) : null;
    const az = Number(params.get('az') ?? 35);
    const el = Number(params.get('el') ?? 18);
    const gridN = Number(params.get('grid') ?? 0);
    const animN = Number(params.get('anim') ?? 0);
    const draw = () => {
      if (animN > 0 && animator) studio.renderPoseGrid(animN, az, el, animator.poseAt);
      else if (gridN > 0) studio.renderTurntable(gridN, el);
      else studio.renderView(az, el);
    };

    window.addEventListener('resize', () => {
      studio.resize(window.innerWidth, window.innerHeight);
      draw();
    });
    studio.resize(window.innerWidth, window.innerHeight);
    draw();

    // Title chip (dev-side convenience; harmless headless).
    document.body.insertAdjacentHTML('beforeend',
      `<div style="position:fixed;left:10px;top:8px;color:#9aa1ab;font:12px monospace;letter-spacing:.05em">${subject.label} · ${subject.kind} · ${subjectId}</div>`);

    window.__bench = {
      ready: true,
      view: (a, e) => studio.renderView(a, e),
      turntable: (n, e) => studio.renderTurntable(n, e),
      anim: (n, e) => { if (animator) studio.renderPoseGrid(n, az, e, animator.poseAt); },
      readout: () => computeReadout(subject, built),
      subjects: () => listSubjects().map((a) => a.scenario),
    };
  }
}

// ── Picker ───────────────────────────────────────────────────────────
function renderPicker(): void {
  canvas.style.display = 'none';
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed', inset: '0', overflowY: 'auto',
    background: '#0b0c0e', color: '#cdd2d8', font: '13px ui-monospace, monospace',
    padding: '14px',
  } as CSSStyleDeclaration);
  root.innerHTML = `<div style="letter-spacing:.25em;color:#6b7280;text-transform:uppercase;margin-bottom:10px">Delve · Asset Bench</div>`;
  for (const a of listSubjects()) {
    const link = document.createElement('a');
    link.href = `?subject=${encodeURIComponent(a.scenario)}`;
    link.textContent = `${a.label}  ·  ${a.scenario}`;
    Object.assign(link.style, {
      display: 'block', padding: '7px 4px', color: '#cdd2d8',
      textDecoration: 'none', borderBottom: '1px solid #16181c',
    } as CSSStyleDeclaration);
    root.appendChild(link);
  }
  document.body.appendChild(root);
}

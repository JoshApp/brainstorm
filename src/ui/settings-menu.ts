import { getSettings, updateSettings, CONTROL_SCHEMES, SHADOW_MODES } from '../settings/settings';
import type { ShadowMode } from '../settings/settings';
import { setMasterVolume, setReverbEnabled } from '../audio/sfx';
import { setMusicVolume } from '../audio/music';
import { openScreen, closeScreen } from './screen-manager';
import { getUpdateStatus, applyUpdate, onUpdateStatusChange } from '../pwa-update';
import { isDesktopLike } from '../controls/platform';
import {
  BINDABLE_ACTIONS, getBinding, setBinding, resetBindings, labelForCode,
  type BindableAction,
} from '../controls/keybindings';

// Settings panel.
//
// Settings persisted via src/settings/settings.ts to localStorage.
// "Run actions" (abandon / quit / exit) live at the bottom of the
// panel — they're app-level shutdowns, kept out of mainline gameplay
// flow but discoverable when the player explicitly opens settings.

const PANEL_BG = 'rgba(20, 14, 10, 0.92)';
const BORDER = '1px solid rgba(180, 130, 90, 0.5)';

let panel: HTMLDivElement | null = null;
let panelOpen = false;

// Run-action handlers — wired by main.ts at boot via configureSettingsMenu.
// Kept out of this module's imports so settings doesn't need to know
// about run-state or the title screen.
interface RunActions {
  abandonRun: () => void;
  quitToMenu: () => void;
  exitGame:   () => void;
}
let runActions: RunActions | null = null;

export function configureSettingsMenu(actions: RunActions) {
  runActions = actions;
  if (panel) buildPanelContents();   // rebuild if already mounted
}

export function createSettingsMenu() {
  if (panel) return;

  // The panel itself, hidden by default. Built ONCE at boot so opens are
  // instant; only callers vary.
  panel = document.createElement('div');
  panel.id = 'settings-panel';
  Object.assign(panel.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    // Mobile-first sizing (matches menu-shell.ts rules): clamp to the
    // viewport minus side safe-area (landscape notches), bound height by
    // the DYNAMIC viewport minus vertical safe-area so it never clips
    // under a notch or runs off a short landscape phone.
    width: 'min(380px, calc(100vw - 24px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)))',
    padding: '16px 18px',
    background: PANEL_BG,
    border: BORDER,
    borderRadius: '4px',
    color: 'rgba(230, 200, 170, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8)',
    zIndex: '100',
    display: 'none',
    flexDirection: 'column',
    gap: '12px',
    // Mobile fit: long settings list overflowed the viewport. Cap
    // the panel height and let the body scroll.
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);
  // Height bound with a fallback chain (vh universal, then dvh refine) so
  // it's always bounded even if the browser chokes on dvh-in-calc — same
  // pattern as menu-shell.ts.
  panel.style.maxHeight = '92vh';
  panel.style.maxHeight = 'calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))';
  document.body.appendChild(panel);

  buildPanelContents();
}

/** Public API — called by other UI (e.g. the inventory header gear)
 *  to open the settings panel. Idempotent. */
export function openSettings() { openPanel(); }
export function closeSettings() { closePanel(); }
export function toggleSettings() {
  if (panelOpen) closePanel(); else openPanel();
}

function openPanel() {
  if (!panel) return;
  // Always open focused on RUN — the most-reached mid-game affordances
  // (CHARACTER, QUIT, etc.) land under the thumb every time. buildPanelContents
  // falls back to CONTROLS when there's no live run (title screen).
  activeTab = 'run';
  buildPanelContents();
  panel.style.display = 'flex';
  panelOpen = true;
  openScreen({
    id: 'settings',
    root: panel,
    onDismissRequest: () => { if (panelOpen) closePanel(); },
  });
}

function closePanel() {
  if (!panel) return;
  panel.style.display = 'none';
  panelOpen = false;
  closeScreen('settings');
}

type TabId = 'run' | 'controls' | 'audio' | 'graphics' | 'system' | 'debug';
// Every open RESETS focus to RUN (see openPanel) — CHARACTER + quit +
// abandon + exit are the most-reached affordances mid-game; falls back to
// CONTROLS on the title screen where RUN doesn't exist yet. Within a single
// open, the field tracks whichever tab the player switched to.
let activeTab: TabId = 'run';

function buildPanelContents() {
  if (!panel) return;
  panel.replaceChildren();

  // Header row — title + close. Stays at panel top above the tabs.
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(180, 130, 90, 0.3)',
    paddingBottom: '6px',
    flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  const title = document.createElement('div');
  title.textContent = 'SETTINGS';
  Object.assign(title.style, {
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.28em',
    color: 'rgba(255, 200, 140, 0.9)',
  } as Partial<CSSStyleDeclaration>);
  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', 'close');
  Object.assign(close.style, {
    background: 'transparent',
    border: 'none',
    color: 'rgba(220, 180, 140, 0.7)',
    fontSize: '18px',
    lineHeight: '1',
    cursor: 'pointer',
    width: '44px',
    height: '44px',
    margin: '-8px -8px -8px 0',   // 44px hit area without bloating the header
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  } as Partial<CSSStyleDeclaration>);
  close.addEventListener('click', closePanel);
  header.append(title, close);
  panel.appendChild(header);

  // Tabs available depend on whether there's a live run — RUN tab
  // appears only when actions are wired. When live, RUN sits FIRST so
  // the most-reached affordances (CHARACTER, QUIT TO MENU, etc.) land
  // under the thumb the moment settings open.
  const tabs: Array<{ id: TabId; label: string }> = [];
  if (runActions) tabs.push({ id: 'run', label: 'RUN' });
  tabs.push(
    { id: 'controls', label: 'CONTROLS' },
    { id: 'audio',    label: 'AUDIO' },
    { id: 'graphics', label: 'GRAPHICS' },
    { id: 'system',   label: 'SYSTEM' },
    { id: 'debug',    label: 'DEBUG' },
  );
  // If the previously-active tab disappeared (e.g. RUN gone after
  // quitting), fall back to CONTROLS — the first non-RUN tab.
  if (!tabs.find((t) => t.id === activeTab)) activeTab = 'controls';

  // Tab bar — horizontal row of buttons. Active tab is highlighted.
  const tabBar = document.createElement('div');
  Object.assign(tabBar.style, {
    display: 'flex',
    gap: '4px',
    borderBottom: '1px solid rgba(180, 130, 90, 0.25)',
    paddingBottom: '6px',
    flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);
  panel.appendChild(tabBar);

  // Content area — scrollable when contents exceed viewport. Body of
  // the active tab is rendered into this on each tab switch.
  const content = document.createElement('div');
  Object.assign(content.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    overflowY: 'auto',
    paddingRight: '4px',
    flex: '1 1 auto',
    minHeight: '0',
    // Cushion the bottom so a swipe-up doesn't overshoot past the
    // last control under iOS overscroll.
    paddingBottom: '8px',
  } as Partial<CSSStyleDeclaration>);
  panel.appendChild(content);

  const renderTab = (id: TabId) => {
    activeTab = id;
    // Refresh the bar's active-state styling.
    for (const child of Array.from(tabBar.children) as HTMLElement[]) {
      const isActive = child.dataset.tabId === id;
      child.style.background = isActive ? 'rgba(80, 50, 30, 0.85)' : 'transparent';
      child.style.color = isActive ? 'rgba(255, 220, 170, 0.98)' : 'rgba(200, 170, 130, 0.65)';
      child.style.borderBottom = isActive ? '2px solid rgba(255, 200, 130, 0.85)' : '2px solid transparent';
    }
    content.replaceChildren();
    for (const el of TAB_BUILDERS[id]()) content.appendChild(el);
  };
  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.textContent = t.label;
    btn.dataset.tabId = t.id;
    Object.assign(btn.style, {
      flex: '1 1 auto',
      minHeight: '42px',
      padding: '8px 4px',
      border: 'none',
      background: 'transparent',
      color: 'rgba(200, 170, 130, 0.65)',
      fontFamily: 'inherit',
      fontSize: '11px',
      fontWeight: '600',
      letterSpacing: '0.18em',
      cursor: 'pointer',
      borderBottom: '2px solid transparent',
      touchAction: 'manipulation',
      transition: 'background 0.12s ease, color 0.12s ease',
    } as Partial<CSSStyleDeclaration>);
    btn.addEventListener('click', () => renderTab(t.id));
    tabBar.appendChild(btn);
  }
  renderTab(activeTab);
}

// ── Tab content builders ───────────────────────────────────────────
// Each builder returns the rows for one tab. Building lazily on
// switch keeps the cost of opening the panel tiny — only the active
// tab's controls are constructed.

const TAB_BUILDERS: Record<TabId, () => HTMLElement[]> = {
  controls: () => buildControlsTab(),

  audio: () => [
    makeSlider({
      label: 'MASTER VOLUME',
      min: 0, max: 1, step: 0.05,
      get: () => getSettings().masterVolume,
      set: (v) => {
        updateSettings({ masterVolume: v });
        setMasterVolume(v);
      },
      format: (v) => `${Math.round(v * 100)}%`,
    }),
    makeSlider({
      label: 'MUSIC VOLUME',
      min: 0, max: 1, step: 0.05,
      get: () => getSettings().musicVolume,
      set: (v) => {
        updateSettings({ musicVolume: v });
        setMusicVolume(v);
      },
      format: (v) => `${Math.round(v * 100)}%`,
    }),
    makeToggle({
      label: 'REVERB',
      description: 'Adds a sense of room to sounds. Turn off if performance drops — the convolver is the most expensive piece of the audio chain on weaker phones.',
      get: () => getSettings().reverb,
      set: (v) => {
        updateSettings({ reverb: v });
        setReverbEnabled(v);
      },
    }),
  ],

  graphics: () => [
    makeSelect<ShadowMode>({
      label: 'SHADOWS',
      description:
        'Dynamic shadows are the most expensive thing on the GPU. ' +
        'Off = none. Hero = your lamp casts (one shadow that follows you). ' +
        'Single = the nearest torch/fire casts. All = lamp + a few nearby lights. ' +
        'Drop it if the phone struggles in a busy room.',
      options: SHADOW_MODES,
      get: () => getSettings().shadows,
      set: (v) => updateSettings({ shadows: v }),
    }),
    makeToggle({
      label: 'ADAPTIVE RESOLUTION',
      description:
        'Auto-lower the render resolution when the phone struggles, and raise ' +
        'it back when it recovers — holds framerate. Reads as a touch more PS1. ' +
        'Mobile only; no effect on desktop.',
      get: () => getSettings().adaptiveResolution,
      set: (v) => updateSettings({ adaptiveResolution: v }),
    }),
    makeToggle({
      label: 'PORTAL CULLING',
      description:
        'Skip rendering rooms hidden behind walls — only the room you’re in ' +
        'and rooms visible through doorways draw. Big draw-call win in corridors. ' +
        'Experimental: if a room ever pops in as you turn, toggle this off.',
      get: () => getSettings().portalCulling,
      set: (v) => updateSettings({ portalCulling: v }),
    }),
  ],

  system: () => [
    makeToggle({
      label: 'AUTO UPDATE',
      description: 'Install new builds automatically at safe moments (title screen, level transitions).',
      get: () => getSettings().autoUpdate,
      set: (v) => updateSettings({ autoUpdate: v }),
    }),
    makeToggle({
      label: 'DEV AUTO-UPDATE',
      description: 'For development. Apply pending updates the instant the service worker detects them, without waiting. Mid-floor state is lost on reload (resumes at floor entry).',
      get: () => getSettings().devAutoUpdate,
      set: (v) => updateSettings({ devAutoUpdate: v }),
    }),
    makeUpdateRow(),
    makeToggle({
      label: 'DEBUG MODE',
      description: 'Show the ⊕ CAPTURE button. Tap it on a glitch to copy a report + screenshot to share.',
      get: () => getSettings().debugMode,
      set: (v) => updateSettings({ debugMode: v }),
    }),
  ],

  // DEBUG tab — on-screen diagnostic overlays, each independently toggleable.
  // Safe to ship (no cheats); off by default so a normal player never sees
  // them. Visibility is applied live by the onSettingsChanged subscription
  // in main.ts.
  debug: () => [
    makeToggle({
      label: 'FPS / PERF METER',
      description: 'Top-right overlay: FPS, frame time, and renderer draw counts. For diagnosing slow moments in the field.',
      get: () => getSettings().perfMeter,
      set: (v) => updateSettings({ perfMeter: v }),
    }),
    makeToggle({
      label: 'EYE ADAPT',
      description: 'Left-side readout of eye dark-adaptation: torch proximity, the 0..1 adapt value, and resulting ambient brightness.',
      get: () => getSettings().debugEyeAdapt,
      set: (v) => updateSettings({ debugEyeAdapt: v }),
    }),
    makeToggle({
      label: 'BOSS ENCOUNTER',
      description: 'During a boss fight only: lists every tracked boss body with its alive/HP + the encounter engaged/done state. For diagnosing a stuck fight.',
      get: () => getSettings().debugBossReadout,
      set: (v) => updateSettings({ debugBossReadout: v }),
    }),
  ],

  run: () => buildRunTab(),
};

/** CONTROLS tab — look sensitivity is shared; the rest splits by device.
 *  Desktop gets rebindable key bindings; touch gets the control-scheme
 *  selector + hybrid-look (a touch-only aim affordance). */
function buildControlsTab(): HTMLElement[] {
  const out: HTMLElement[] = [
    makeSlider({
      label: 'LOOK SENSITIVITY',
      min: 0.001, max: 0.012, step: 0.0005,
      get: () => getSettings().lookSensitivity,
      set: (v) => updateSettings({ lookSensitivity: v }),
      format: (v) => v.toFixed(4),
    }),
  ];

  if (isDesktopLike()) {
    out.push(makeKeybindingsSection());
  } else {
    out.push(makeSelect({
      label: 'CONTROL SCHEME',
      description: 'How touch controls are laid out. More schemes coming.',
      options: CONTROL_SCHEMES,
      get: () => getSettings().controlScheme,
      set: (v) => updateSettings({ controlScheme: v }),
    }));
    out.push(makeToggle({
      label: 'HYBRID LOOK',
      description: 'Drag past the aim zone to keep rotating (like a joystick).',
      get: () => getSettings().hybridLook,
      set: (v) => updateSettings({ hybridLook: v }),
    }));
  }
  return out;
}

/** KEY BINDINGS block (desktop). A row per action shows its current
 *  key; tapping the key enters capture mode and the next press rebinds
 *  it. A RESET restores defaults. Self-contained re-render — no global
 *  subscription to leak. */
function makeKeybindingsSection(): HTMLDivElement {
  const section = document.createElement('div');
  Object.assign(section.style, { display: 'flex', flexDirection: 'column', gap: '8px' } as Partial<CSSStyleDeclaration>);

  // Heading row: label + RESET.
  const head = document.createElement('div');
  Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as Partial<CSSStyleDeclaration>);
  const heading = document.createElement('span');
  heading.textContent = 'KEY BINDINGS';
  Object.assign(heading.style, {
    fontSize: '11px', fontWeight: '600', letterSpacing: '0.22em',
    color: 'rgba(255, 200, 140, 0.85)',
  } as Partial<CSSStyleDeclaration>);
  const reset = document.createElement('button');
  reset.textContent = 'RESET';
  Object.assign(reset.style, {
    background: 'transparent', border: '1px solid rgba(180, 130, 90, 0.4)',
    borderRadius: '3px', color: 'rgba(200, 170, 130, 0.75)',
    fontFamily: 'inherit', fontSize: '10px', fontWeight: '600',
    letterSpacing: '0.18em', padding: '4px 8px', cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  head.append(heading, reset);
  section.appendChild(head);

  const rows = document.createElement('div');
  Object.assign(rows.style, { display: 'flex', flexDirection: 'column', gap: '5px' } as Partial<CSSStyleDeclaration>);
  section.appendChild(rows);

  // Only one capture is live at a time; the cleanup cancels a prior one.
  let cancelCapture: (() => void) | null = null;

  const renderRows = () => {
    if (cancelCapture) { cancelCapture(); cancelCapture = null; }
    rows.replaceChildren();
    for (const { id, label } of BINDABLE_ACTIONS) {
      rows.appendChild(makeKeybindRow(id, label));
    }
  };

  const makeKeybindRow = (action: BindableAction, label: string): HTMLDivElement => {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
    } as Partial<CSSStyleDeclaration>);

    const name = document.createElement('span');
    name.textContent = label;
    Object.assign(name.style, {
      fontSize: '11px', letterSpacing: '0.12em', color: 'rgba(220, 180, 140, 0.85)',
    } as Partial<CSSStyleDeclaration>);

    const key = document.createElement('button');
    key.textContent = labelForCode(getBinding(action));
    Object.assign(key.style, {
      minWidth: '64px', padding: '5px 10px',
      background: 'rgba(40, 28, 20, 0.7)', border: '1px solid rgba(180, 130, 90, 0.5)',
      borderRadius: '3px', color: 'rgba(255, 220, 180, 0.95)',
      fontFamily: 'monospace', fontSize: '11px', fontWeight: '600',
      letterSpacing: '0.06em', cursor: 'pointer', textAlign: 'center',
    } as Partial<CSSStyleDeclaration>);

    key.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cancelCapture) { cancelCapture(); cancelCapture = null; }
      // Drop focus so a Space/Enter rebind doesn't also re-activate
      // this button on keyup (which would instantly re-open capture).
      key.blur();
      key.textContent = 'PRESS A KEY';
      key.style.background = 'rgba(120, 70, 30, 0.85)';
      key.style.borderColor = 'rgba(255, 200, 130, 0.85)';

      // Capture phase + stopImmediatePropagation: run before the
      // desktop scheme's bubble-phase keydown so the rebind keystroke
      // never also fires a game action. Escape cancels without binding.
      const onKey = (ev: KeyboardEvent) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        cancelCapture = null;
        window.removeEventListener('keydown', onKey, true);
        if (ev.code !== 'Escape') setBinding(action, ev.code);
        renderRows();
      };
      window.addEventListener('keydown', onKey, { capture: true });
      cancelCapture = () => {
        window.removeEventListener('keydown', onKey, true);
        key.textContent = labelForCode(getBinding(action));
        key.style.background = 'rgba(40, 28, 20, 0.7)';
        key.style.borderColor = 'rgba(180, 130, 90, 0.5)';
      };
    });

    row.append(name, key);
    return row;
  };

  reset.addEventListener('click', () => { resetBindings(); renderRows(); });
  renderRows();
  return section;
}

/** RUN tab — character + quit + abandon + exit. Lives behind a tab
 *  switch so destructive buttons can't be hit by accident while
 *  scrolling through volume sliders. */
function buildRunTab(): HTMLElement[] {
  if (!runActions) return [];
  const out: HTMLElement[] = [];

// CHARACTER — view attributes + proficiencies + spend points (at
  // safe rooms). Top of the tab so it's easy to reach from touch.
  out.push(makeRunButton({
    label: 'CHARACTER',
    description: 'View attributes + proficiencies. Spend points at safe rooms.',
    destructive: false,
    onClick: () => {
      closePanel();
      // Lazy import to avoid the settings menu pulling the screen at
      // module load.
      import('./character-screen').then(({ openCharacterScreen }) => openCharacterScreen());
    },
  }));
  out.push(makeRunButton({
    label: 'QUIT TO MENU',
    description: 'Return to the title screen. Your run is saved.',
    destructive: false,
    onClick: () => {
      closePanel();
      runActions!.quitToMenu();
    },
  }));
  out.push(makeRunButton({
    label: 'ABANDON RUN',
    description: 'Discard this run. Inventory, depth, and progress are lost.',
    destructive: true,
    onClick: () => {
      closePanel();
      runActions!.abandonRun();
    },
  }));
  out.push(makeRunButton({
    label: 'EXIT GAME',
    description: 'Close the game tab. (On mobile, returns to the home screen.)',
    destructive: false,
    onClick: () => runActions!.exitGame(),
  }));
  return out;
}

interface RunButtonOpts {
  label: string;
  description: string;
  destructive: boolean;
  onClick: () => void;
}

/** A two-step-confirm button. First tap arms the button (label
 *  becomes "TAP AGAIN TO CONFIRM"); second tap within 2.5s commits.
 *  Non-destructive buttons skip the confirm and fire immediately. */
function makeRunButton(opts: RunButtonOpts): HTMLDivElement {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  } as Partial<CSSStyleDeclaration>);

  const button = document.createElement('button');
  button.textContent = opts.label;
  const baseBg = opts.destructive ? 'rgba(60, 18, 12, 0.7)' : 'rgba(40, 28, 20, 0.7)';
  const baseBorder = opts.destructive ? 'rgba(200, 80, 60, 0.55)' : 'rgba(180, 130, 90, 0.5)';
  const baseColor = opts.destructive ? 'rgba(255, 190, 170, 0.95)' : 'rgba(230, 200, 170, 0.95)';
  Object.assign(button.style, {
    padding: '9px 14px',
    background: baseBg,
    border: `1px solid ${baseBorder}`,
    borderRadius: '3px',
    color: baseColor,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.22em',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
    transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(button);

  const desc = document.createElement('div');
  desc.textContent = opts.description;
  Object.assign(desc.style, {
    fontSize: '10px',
    color: 'rgba(180, 140, 100, 0.7)',
    paddingLeft: '2px',
  } as Partial<CSSStyleDeclaration>);
  wrap.appendChild(desc);

  if (!opts.destructive) {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onClick();
    });
    return wrap;
  }

  // Destructive: two-step confirm.
  let armed = false;
  let armTimer: number | undefined;
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!armed) {
      armed = true;
      button.textContent = 'TAP AGAIN TO CONFIRM';
      button.style.background = 'rgba(120, 30, 22, 0.85)';
      button.style.borderColor = 'rgba(255, 120, 80, 0.85)';
      button.style.color = 'rgba(255, 230, 220, 0.98)';
      if (armTimer !== undefined) clearTimeout(armTimer);
      armTimer = window.setTimeout(() => {
        armed = false;
        button.textContent = opts.label;
        button.style.background = baseBg;
        button.style.borderColor = baseBorder;
        button.style.color = baseColor;
      }, 2500);
    } else {
      if (armTimer !== undefined) clearTimeout(armTimer);
      opts.onClick();
    }
  });
  return wrap;
}

interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  format?: (v: number) => string;
}

function makeSlider(opts: SliderOpts): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', flexDirection: 'column', gap: '6px' } as Partial<CSSStyleDeclaration>);

  const labelRow = document.createElement('div');
  Object.assign(labelRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('span');
  label.textContent = opts.label;
  Object.assign(label.style, {
    fontSize: '11px',
    fontWeight: '500',
    letterSpacing: '0.18em',
    color: 'rgba(220, 180, 140, 0.9)',
  } as Partial<CSSStyleDeclaration>);

  const valueLabel = document.createElement('span');
  valueLabel.textContent = opts.format ? opts.format(opts.get()) : String(opts.get());
  Object.assign(valueLabel.style, {
    fontSize: '11px',
    color: 'rgba(180, 140, 100, 0.8)',
    fontFamily: 'monospace',
  } as Partial<CSSStyleDeclaration>);

  labelRow.append(label, valueLabel);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(opts.min);
  slider.max = String(opts.max);
  slider.step = String(opts.step);
  slider.value = String(opts.get());
  Object.assign(slider.style, {
    width: '100%',
    accentColor: 'rgba(255, 160, 80, 0.9)',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    opts.set(v);
    valueLabel.textContent = opts.format ? opts.format(v) : String(v);
  });

  row.append(labelRow, slider);
  return row;
}

interface ToggleOpts {
  label: string;
  description?: string;
  get: () => boolean;
  set: (v: boolean) => void;
}

function makeToggle(opts: ToggleOpts): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);

  const top = document.createElement('div');
  Object.assign(top.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('span');
  label.textContent = opts.label;
  Object.assign(label.style, {
    fontSize: '11px',
    fontWeight: '500',
    letterSpacing: '0.18em',
    color: 'rgba(220, 180, 140, 0.9)',
  } as Partial<CSSStyleDeclaration>);

  const switchEl = document.createElement('div');
  Object.assign(switchEl.style, {
    width: '36px',
    height: '20px',
    borderRadius: '10px',
    background: opts.get() ? 'rgba(255, 160, 80, 0.6)' : 'rgba(60, 40, 30, 0.6)',
    position: 'relative',
    transition: 'background 0.15s',
  } as Partial<CSSStyleDeclaration>);
  const knob = document.createElement('div');
  Object.assign(knob.style, {
    position: 'absolute',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    background: 'rgba(240, 220, 200, 0.95)',
    top: '2px',
    left: opts.get() ? '18px' : '2px',
    transition: 'left 0.15s',
  } as Partial<CSSStyleDeclaration>);
  switchEl.appendChild(knob);

  top.append(label, switchEl);
  row.appendChild(top);

  if (opts.description) {
    const desc = document.createElement('div');
    desc.textContent = opts.description;
    Object.assign(desc.style, {
      fontSize: '11px',
      color: 'rgba(160, 130, 100, 0.7)',
      fontStyle: 'italic',
    } as Partial<CSSStyleDeclaration>);
    row.appendChild(desc);
  }

  row.addEventListener('click', () => {
    const newVal = !opts.get();
    opts.set(newVal);
    switchEl.style.background = newVal ? 'rgba(255, 160, 80, 0.6)' : 'rgba(60, 40, 30, 0.6)';
    knob.style.left = newVal ? '18px' : '2px';
  });

  return row;
}

interface SelectOpts<T extends string> {
  label: string;
  description?: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  get: () => T;
  set: (v: T) => void;
}

/** A labelled dropdown. Used for the touch control-scheme picker — a
 *  one-option seam today, but the UI is ready for more. */
function makeSelect<T extends string>(opts: SelectOpts<T>): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', flexDirection: 'column', gap: '6px' } as Partial<CSSStyleDeclaration>);

  const top = document.createElement('div');
  Object.assign(top.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('span');
  label.textContent = opts.label;
  Object.assign(label.style, {
    fontSize: '11px', fontWeight: '500', letterSpacing: '0.18em',
    color: 'rgba(220, 180, 140, 0.9)',
  } as Partial<CSSStyleDeclaration>);

  const select = document.createElement('select');
  Object.assign(select.style, {
    background: 'rgba(40, 28, 20, 0.7)', border: '1px solid rgba(180, 130, 90, 0.5)',
    borderRadius: '3px', color: 'rgba(230, 200, 170, 0.95)',
    fontFamily: 'inherit', fontSize: '11px', padding: '5px 8px', cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  for (const o of opts.options) {
    const optEl = document.createElement('option');
    optEl.value = o.id;
    optEl.textContent = o.label;
    select.appendChild(optEl);
  }
  select.value = opts.get();
  select.addEventListener('change', () => opts.set(select.value as T));

  top.append(label, select);
  row.appendChild(top);

  if (opts.description) {
    const desc = document.createElement('div');
    desc.textContent = opts.description;
    Object.assign(desc.style, {
      fontSize: '11px', color: 'rgba(160, 130, 100, 0.7)', fontStyle: 'italic',
    } as Partial<CSSStyleDeclaration>);
    row.appendChild(desc);
  }
  return row;
}

/** Update status row: shows "UP TO DATE" (disabled) or "INSTALL UPDATE"
 *  (tappable, applies the pending SW). Live-updates when the status
 *  changes — subscribes to pwa-update via onUpdateStatusChange. */
function makeUpdateRow(): HTMLDivElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
  } as Partial<CSSStyleDeclaration>);

  const label = document.createElement('div');
  label.textContent = 'UPDATE';
  Object.assign(label.style, {
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.25em',
    color: 'rgba(220, 180, 140, 0.85)',
  } as Partial<CSSStyleDeclaration>);
  row.appendChild(label);

  const button = document.createElement('button');
  Object.assign(button.style, {
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.25em',
    borderRadius: '3px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as Partial<CSSStyleDeclaration>);

  function render() {
    const pending = getUpdateStatus() === 'pending';
    if (pending) {
      button.textContent = 'INSTALL NOW';
      button.disabled = false;
      Object.assign(button.style, {
        background: 'rgba(255, 160, 80, 0.6)',
        border: '1px solid rgba(255, 200, 140, 0.8)',
        color: 'rgba(255, 240, 220, 0.98)',
      } as Partial<CSSStyleDeclaration>);
    } else {
      button.textContent = 'UP TO DATE';
      button.disabled = true;
      Object.assign(button.style, {
        background: 'rgba(40, 32, 26, 0.6)',
        border: '1px solid rgba(120, 90, 70, 0.4)',
        color: 'rgba(150, 130, 110, 0.65)',
        cursor: 'default',
      } as Partial<CSSStyleDeclaration>);
    }
  }
  render();
  onUpdateStatusChange(render);

  button.addEventListener('click', () => {
    if (getUpdateStatus() !== 'pending') return;
    button.textContent = 'INSTALLING…';
    button.disabled = true;
    void applyUpdate();   // triggers reload — this panel goes away with it
  });
  row.appendChild(button);

  return row;
}

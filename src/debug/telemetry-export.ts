// Telemetry export (DEV tool) — bundle the local play history into a JSON file
// you can read offline with `delve stats`, so balancing doesn't need a backend.
//
// It composes two already-persisted sources:
//   - meta-state (lifetime aggregate: runs, deepest depth, kills, unique
//     enemies/items) — the "who is this player" substrate.
//   - the telemetry event ring (per-event: boot / run_start / death{depth,
//     kills,killedBy,itemsFound,elapsedMs}) — the "what happened each run" log.
//
// exportTelemetry() triggers a browser download; buildTelemetryBundle() returns
// the object (for a settings button, a test, or console inspection).

import { getTelemetryLog } from '../telemetry/telemetry';
import { getMetaSnapshot } from '../state/meta-state';

declare const __BUILD_SHA__: string;

export interface TelemetryBundle {
  build: string;
  exportedAt: number;
  meta: ReturnType<typeof getMetaSnapshot>;
  events: ReturnType<typeof getTelemetryLog>;
}

export function buildTelemetryBundle(): TelemetryBundle {
  return {
    build: typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev',
    exportedAt: Date.now(),
    meta: getMetaSnapshot(),
    events: getTelemetryLog(),
  };
}

/** Download the telemetry bundle as JSON. Falls back to console.log if the DOM
 *  download path is blocked (e.g. headless). */
export function exportTelemetry(): TelemetryBundle {
  const bundle = buildTelemetryBundle();
  const json = JSON.stringify(bundle, null, 2);
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `delve-telemetry-${bundle.exportedAt}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    console.log(`[telemetry] exported ${bundle.events.length} events → download. Read with: npm run delve stats <file>`);
  } catch {
    console.log('[telemetry] download blocked — bundle follows:\n' + json);
  }
  return bundle;
}

import { createSheet, menuButton } from '../ui/menu-shell';
import { THEME } from '../ui/theme';
import { captureFrameContext } from './frame-capture';
import { getCurrentDepth } from '../level/loader';
import { getRunState } from '../state/run-state';
import { buildTelemetryBundle } from '../debug/telemetry-export';
import { getStoredGpuErrorReport } from '../scene/context-recovery';

// IN-GAME BUG REPORT — file a report from inside a running game (when it hasn't
// crashed). Bundles a SCREENSHOT of the current frame, the RUN CONTEXT (depth,
// floor, seed, camera, build) and a TELEMETRY snapshot with the reporter's text,
// then hands it off via the Web Share sheet (mobile) or a download fallback.
// Player-safe + DEV-safe: telemetry is the same local data `delve stats` reads,
// the screenshot is the clean game view, and nothing leaves the device unless
// the player picks a target in the share sheet.

declare const __BUILD_SHA__: string;

export interface BugReport {
  build: string;
  at: number;
  userText: string;
  run: {
    depth: number;
    floorId: string | null;
    seed: number | null;
    cameraPos: { x: number; y: number; z: number } | null;
    yaw: number | null;
    /** With yaw, enough to restore the exact view. `delve repro` replays both. */
    pitch: number | null;
  };
  /**
   * WHAT THE REPORT IS ABOUT — the crosshair raycast, named (report/look-target.ts).
   *
   * The seed + depth + pose already let a reader rebuild the floor and stand
   * where the player stood. This is the missing half: which geometry, and which
   * system produced it. It turns "some corridors and doors generate faulty"
   * into an owner chain and a world position that name the file to open.
   */
  looking: import('./look-target').LookTarget | null;
  device: { userAgent: string; viewport: { w: number; h: number }; dpr: number; language: string };
  screenshot: string | null;   // PNG data URL
  telemetry: ReturnType<typeof buildTelemetryBundle>;
  /**
   * The last GPU uncaptured-error episode, verbatim (scene/context-recovery.ts).
   *
   * WebGPU names the resource that died on the device's 'uncapturederror'
   * channel, and the recovery watch has been recording the first few messages to
   * localStorage since it was written — but NOTHING read them back. So the one
   * artifact that says WHAT broke lived on the phone and never left it, while
   * the player could only report the sentence on the veil ("something below has
   * shifted"), which names nothing. It rides along with every report now.
   */
  gpuErrors: string | null;
}

/** Gather everything for a report. Pure data-collection; the screenshot is
 *  captured now (a fresh render, async WebGPU-safe readback), the rest read from
 *  live state. */
export async function buildBugReport(userText: string): Promise<BugReport> {
  const frame = await captureFrameContext();
  const run = getRunState();
  return {
    build: typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev',
    at: Date.now(),
    userText,
    run: {
      depth: getCurrentDepth(),
      floorId: run?.floorId ?? null,
      seed: run?.startedAt ?? null,
      cameraPos: frame?.cameraPos ?? null,
      yaw: frame?.yaw ?? null,
      pitch: frame?.pitch ?? null,
    },
    looking: frame?.look ?? null,
    device: {
      userAgent: navigator.userAgent,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dpr: window.devicePixelRatio,
      language: navigator.language,
    },
    screenshot: frame?.png ?? null,
    telemetry: buildTelemetryBundle(),
    gpuErrors: getStoredGpuErrorReport(),
  };
}

/** Human-readable header for the report (shared as the message text; the full
 *  JSON rides alongside as an attached file). */
function reportSummary(r: BugReport): string {
  const c = r.run.cameraPos;
  const pos = c ? `(${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)})` : 'unknown';
  return [
    'DELVE bug report',
    r.userText.trim() ? `\n${r.userText.trim()}\n` : '\n(no description)\n',
    `build: ${r.build}`,
    `depth: ${r.run.depth}   floor: ${r.run.floorId ?? '?'}   seed: ${r.run.seed ?? '?'}`,
    `pos: ${pos}`,
    `device: ${r.device.viewport.w}×${r.device.viewport.h} @${r.device.dpr}x`,
    `runs: ${r.telemetry.meta.runsAttempted ?? 0}   deepest: ${r.telemetry.meta.deepestDepth ?? 0}`,
  ].join('\n');
}

function dataUrlToFile(dataUrl: string, name: string): File | null {
  const m = dataUrl.match(/^data:(.+?);base64,(.*)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: m[1] });
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** POST the report to the configured collector (a REST endpoint — Supabase
 *  `/rest/v1/reports` or any store that accepts a JSON insert). Returns true on
 *  success. Endpoint + anon key come from build-time env (VITE_REPORT_ENDPOINT /
 *  VITE_REPORT_KEY); unset → no upload (the share/download path carries it). The
 *  anon key is safe to embed: the table's RLS allows INSERT only. See the puller
 *  in scripts/reports.ts + the setup note there. */
async function uploadReport(r: BugReport): Promise<boolean> {
  const endpoint = import.meta.env.VITE_REPORT_ENDPOINT as string | undefined;
  if (!endpoint) return false;
  const key = import.meta.env.VITE_REPORT_KEY as string | undefined;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Supabase REST wants the anon key in BOTH headers; harmless elsewhere.
        ...(key ? { apikey: key, Authorization: `Bearer ${key}` } : {}),
        Prefer: 'return=minimal',
      },
      // Store the whole report under a single `data` jsonb column — the table
      // schema stays trivial (id, created_at, data) and the puller reads it back.
      body: JSON.stringify({ data: r }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Send the report: upload to the collector if configured; otherwise (or on
 *  failure) prefer the native share sheet, falling back to a file download.
 *  Returns a short status string for the UI. */
async function sendReport(r: BugReport): Promise<string> {
  // Primary: the database. This is what lets the keepers PULL reports into a
  // worklist without the reporter forwarding anything by hand.
  if (await uploadReport(r)) return 'Sent to the keepers. Thank you.';

  const stamp = r.at;
  const jsonFile = new File([JSON.stringify(r, null, 2)], `delve-report-${stamp}.json`, { type: 'application/json' });
  const pngFile = r.screenshot ? dataUrlToFile(r.screenshot, `delve-report-${stamp}.png`) : null;
  const summary = reportSummary(r);
  const files = pngFile ? [pngFile, jsonFile] : [jsonFile];

  const shareApi = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };
  // Try the richest share the platform allows (both files → png only → text).
  if (shareApi.share && shareApi.canShare) {
    try {
      if (shareApi.canShare({ files })) {
        await shareApi.share({ files, title: 'DELVE bug report', text: summary });
        return 'Shared. Thank you.';
      }
      if (pngFile && shareApi.canShare({ files: [pngFile] })) {
        await shareApi.share({ files: [pngFile], title: 'DELVE bug report', text: summary });
        return 'Shared. Thank you.';
      }
    } catch (e) {
      // User cancelled the share sheet → not an error; anything else falls through.
      if ((e as Error)?.name === 'AbortError') return 'Cancelled.';
    }
  }
  // Fallback: save the files so the reporter can attach them manually.
  if (pngFile) downloadBlob(pngFile, pngFile.name);
  downloadBlob(jsonFile, jsonFile.name);
  return 'Saved to your device — attach these to your report.';
}

/** Open the report form. Captures the frame on open so the preview shows exactly
 *  what will be sent. The capture is an async GPU readback (WebGPU-safe), so we
 *  await it before building the sheet — a few ms, imperceptible. */
export async function openBugReport(): Promise<void> {
  const report = await buildBugReport('');   // capture the frame NOW (before the sheet dims things)

  const sheet = createSheet({
    id: 'bug-report',
    title: 'REPORT AN ISSUE',
    width: 460,
    policy: { pausesWorld: true, needsBackdrop: true },
  });

  const intro = document.createElement('div');
  Object.assign(intro.style, { color: THEME.dim, fontSize: '12px', lineHeight: '1.5', margin: '0 2px 10px' } as Partial<CSSStyleDeclaration>);
  intro.textContent = 'Tell the keepers what went wrong. Your current view, run, and diagnostics ride along.';
  sheet.body.appendChild(intro);

  // Screenshot preview — so the reporter sees what's attached.
  if (report.screenshot) {
    const img = document.createElement('img');
    img.src = report.screenshot;
    Object.assign(img.style, {
      width: '100%', maxHeight: '160px', objectFit: 'contain',
      border: `1px solid ${THEME.ruleStrong}`, borderRadius: '3px',
      background: '#000', marginBottom: '10px', imageRendering: 'auto',
    } as Partial<CSSStyleDeclaration>);
    sheet.body.appendChild(img);
  }

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'What happened? What did you expect?';
  textarea.rows = 4;
  Object.assign(textarea.style, {
    width: '100%', boxSizing: 'border-box', resize: 'vertical',
    background: THEME.sunken, color: THEME.text, border: `1px solid ${THEME.ruleStrong}`,
    borderRadius: '3px', padding: '8px 10px', fontFamily: 'inherit', fontSize: '13px',
    lineHeight: '1.4', marginBottom: '6px',
  } as Partial<CSSStyleDeclaration>);
  sheet.body.appendChild(textarea);

  // Context line — reassures the reporter what's captured, and helps them if
  // they read it back.
  const ctx = document.createElement('div');
  Object.assign(ctx.style, { color: THEME.faint, fontSize: '10px', letterSpacing: '0.04em', marginBottom: '4px' } as Partial<CSSStyleDeclaration>);
  ctx.textContent = `build ${report.build} · depth ${report.run.depth} · seed ${report.run.seed ?? '?'}${report.screenshot ? ' · screenshot ✓' : ' · screenshot unavailable'}`;
  sheet.body.appendChild(ctx);

  const status = document.createElement('div');
  Object.assign(status.style, { color: THEME.dim, fontSize: '12px', minHeight: '16px', margin: '6px 2px 0' } as Partial<CSSStyleDeclaration>);
  sheet.body.appendChild(status);

  const send = menuButton('SEND REPORT', async () => {
    send.disabled = true;
    status.textContent = 'Sending…';
    report.userText = textarea.value;
    try {
      status.textContent = await sendReport(report);
    } catch {
      status.textContent = 'Could not send — try again.';
    }
    send.disabled = false;
  }, { primary: true });
  sheet.footer.appendChild(menuButton('CANCEL', () => sheet.close()));
  sheet.footer.appendChild(send);

  sheet.open();
  // Focus the field so the keyboard comes up ready to type on mobile.
  setTimeout(() => textarea.focus(), 60);
}

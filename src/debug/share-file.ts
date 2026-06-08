// Share a generated diagnostic file off the device. On a phone the OS share
// sheet (AirDrop / email-to-self / messages) is the only practical way to get a
// file to the PC; falls back to a download when sharing isn't available. Called
// straight from a button tap so the share gesture stays valid.

export async function shareOrDownload(filename: string, text: string, mime = 'text/plain'): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (d: { files: File[] }) => boolean;
    share?: (d: { files: File[]; title?: string }) => Promise<void>;
  };
  try {
    const file = new File([text], filename, { type: mime });
    if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: filename });
      return true;
    }
  } catch {
    // user cancelled or share failed — fall through to download
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return false;
}

// Brief on-screen confirmation toast.
let el: HTMLDivElement | null = null;
let timer = 0;
export function flash(msg: string): void {
  if (!el) {
    el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      bottom: 'calc(110px + env(safe-area-inset-bottom, 0px))',
      left: '50%',
      transform: 'translateX(-50%)',
      maxWidth: '82vw',
      padding: '8px 14px',
      background: 'rgba(8, 14, 22, 0.92)',
      border: '1px solid rgba(140, 200, 255, 0.35)',
      borderRadius: '8px',
      color: 'rgba(200, 230, 255, 0.95)',
      font: '500 12px ui-monospace, monospace',
      whiteSpace: 'pre',
      textAlign: 'center',
      pointerEvents: 'none',
      zIndex: '9001',
      transition: 'opacity 0.3s',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(timer);
  timer = window.setTimeout(() => { if (el) el.style.opacity = '0'; }, 3500);
}

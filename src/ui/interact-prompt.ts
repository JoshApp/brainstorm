// DEPRECATED. The bottom-center floating prompt has been merged into the
// bottom-left interact button (src/controls/use-button.ts), which now
// shows an icon + label combined. These shims remain so callers don't
// break; they no-op.

export function createInteractPrompt(): void {
  // intentionally empty — button owns the prompt now
}

export function setInteractPrompt(_label: string | null): void {
  // intentionally empty
}

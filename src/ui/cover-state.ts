// Is the black descent cover fully up (nothing of the world visible)? Set by
// ui/descent-fade.ts from the moment the cover rises until the reveal starts
// fading it; read by player/arrival.ts, which holds the eyelids shut meanwhile
// so the eyes open AS the floor appears. Its own module, import-free, so the
// arrival (reached from sim code and its tests) never pulls in the descent
// screen's DOM, fonts and art.

let coverUp = false;
export function isCoverUp(): boolean { return coverUp; }
export function setCoverUp(up: boolean): void { coverUp = up; }

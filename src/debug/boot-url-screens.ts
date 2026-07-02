// Boot-time debug URL flags — fake persisted state for snaps, and the ?show*
// screen-preview hooks that replace the whole boot flow with a single UI
// screen. Extracted from main.ts; gating is unchanged (these are safe,
// read-only-ish snap aids and the screens are inert without game state).

/** Seed fake meta / save state for title-screen snaps. `?fakemeta=1` shows
 *  records + the CODEX/STASH buttons; `?fakesave=1` shows CONTINUE. */
export function applyFakeStateFlags(): void {
  if (new URLSearchParams(window.location.search).get('fakemeta') === '1') {
    localStorage.setItem('delve:meta', JSON.stringify({
      version: 2,
      runsAttempted: 7, runsDied: 6, deepestDepth: 4, totalKills: 31,
      totalPlayMs: 4 * 60 * 1000,
      enemiesSlain: ['rat', 'skirmisher', 'ghoul'],
      itemsFound: ['rusted-sword', 'scimitar', 'flask-draught', 'leather-gloves',
                   'worn-boots', 'ring-of-vigor', 'iron-coif'],
      notesRead: [
        'I came for the blade. I should have come for the door.',
        'They told us it was one floor. They counted wrong.',
      ],
      achievementsUnlocked: ['first-blood', 'untouched', 'depth-3-reached'],
      stash: [
        { id: 'a1', tier: 'uncommon', source: 'Untouched' },
        { id: 'a2', tier: 'rare', source: 'The Dungeon Notices' },
        { id: 'a3', tier: 'fabled', source: 'Magic Bypass' },
      ],
    }));
  }
  if (new URLSearchParams(window.location.search).get('fakesave') === '1') {
    localStorage.setItem('delve:save', JSON.stringify({
      version: 1, floorId: 'depth-2', depth: 2, hp: 4,
      inventory: { 'flask-draught': 2 },
      equipment: { weapon: 'scimitar' },
      startedAt: Date.now() - 240000, kills: 7, itemsFound: ['scimitar', 'flask-draught'],
    }));
  }
}

/** The ?show* screen-preview hooks — each skips the game entirely and mounts
 *  one UI screen with mocked stats. Returns true when one fired (the caller's
 *  boot flow stops there). */
export function handleDebugScreenFlags(): boolean {
  const url = new URLSearchParams(window.location.search);
  if (url.get('showEnd') === '1') {
    void import('../ui/end-screen').then(({ showEndScreen }) => {
      showEndScreen(
        {
          depth: 2, kills: 7, itemsFound: 5, elapsed: '4:12',
          epitaph: 'she was unmade in the first dark.',
          discoveries: {
            enemies: ['wraith'],
            items: ['heartburn', 'bone-amulet'],
            notes: 2,
            newDepthRecord: true,
          },
        },
        () => window.location.reload(),
      );
    });
    return true;
  }
  if (url.get('showCodex') === '1') {
    void import('../ui/codex-screen').then(({ showCodex }) => showCodex());
    return true;
  }
  if (url.get('showStash') === '1') {
    void import('../ui/stash-screen').then(({ showStash }) => showStash());
    return true;
  }
  if (url.get('showPatchlog') === '1') {
    void import('../ui/patchlog-screen').then(({ showPatchlog }) => showPatchlog());
    return true;
  }
  if (url.get('showSafeTransition') === '1') {
    // Preview the safe-room transition card with mocked stats.
    void import('../ui/safe-room-transition').then(({ showSafeRoomTransition }) => {
      showSafeRoomTransition({
        actName: 'The Old Refectory',
        depth: 3,
        kills: 14,
        xp: 247,
      });
    });
    return true;
  }
  return false;
}

// External community links for the build-in-public launch.
//
// COMMUNITY_URL is BLANK by default, which HIDES the link everywhere — so a
// placeholder never ships as a dead button on the live URL. Drop the real
// Discord invite in here and it lights up on the title screen + the end screen
// automatically. One constant, one place to swap.

export const COMMUNITY_URL = ''; // e.g. 'https://discord.gg/xxxxxxx'
export const COMMUNITY_LABEL = 'DISCORD';

/** True once a real invite is set — the link renders only then. */
export function hasCommunityLink(): boolean {
  return COMMUNITY_URL.length > 0;
}

/** Open the community link in a new tab (noopener — never hand the opener over). */
export function openCommunityLink(): void {
  if (!COMMUNITY_URL) return;
  window.open(COMMUNITY_URL, '_blank', 'noopener,noreferrer');
}

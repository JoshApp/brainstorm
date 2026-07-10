/**
 * Relic art specs — the DATA the art pipeline consumes to generate 2.5D relic
 * OBJECT sprites (docs/BUILD-ECONOMY.md "Art direction: one occult world, 2.5D,
 * cheap"; docs/RELICS.md Handoff 1). Same FLUX pipeline as the tarot cards, but
 * a different PRESENTATION: a relic is a single grotesque cursed OBJECT on
 * black (a wrapped talisman, a gorged tick, a sealed heart), NOT a framed card.
 *
 *   delve art relic drowned-heart          generate 1
 *   delve art relic drowned-heart --n 4    a batch to explore
 *   delve art relic gorged-tick --from r12 --tweak "wetter, more gorged"
 *
 * `art` describes the OBJECT (what it is, not the look — the style layer carries
 * the ink/Mörk Borg register). Prompts are built from the relic's provenance +
 * the Blood domain's register.artTokens (content/domains.ts). Once a run is
 * promoted, the billboard presentation (the pilot's second half — see RELICS.md)
 * shows it as a camera-facing sprite in-world + a reliquary icon.
 *
 * `id` matches the ItemSpec id (content/items.ts) so the runtime binds art→relic
 * by id, exactly like cards.
 */
import type { DomainId } from '../content/domains';

export interface RelicArtSpec {
  /** Matches the relic's ItemSpec id. */
  id: string;
  name: string;
  domain: DomainId;
  /** The single spot colour woven into the prompt (the domain accent). */
  accent: string;
  /** The OBJECT description — WHAT it is, not the look. Grotesque, terse. */
  art: string;
  /** Fixed seed for reproducible regen; fork promising runs with --from/--tweak. */
  seed: number;
}

export const RELIC_ART: RelicArtSpec[] = [
  {
    id: 'gorged-tick', name: 'A gorged tick', domain: 'blood', accent: 'dried-blood crimson',
    art: 'a single swollen blood-tick the size of a fist, gorged and glistening, legs curled beneath it, clamped to a shred of grey drained flesh, a single object centred on black',
    seed: 4101,
  },
  {
    id: 'weeping-splinter', name: 'A weeping splinter', domain: 'blood', accent: 'crimson',
    art: 'a long splinter of yellowed saint\'s bone, wet at the tip, a single bead of dark blood welling and refusing to clot, bound with a scrap of red thread, a single object centred on black',
    seed: 4102,
  },
  {
    id: 'sanguine-ring', name: 'A blood-drinker’s stone', domain: 'blood', accent: 'dark crimson',
    art: 'a dark red gemstone in a worn iron setting, the metal drunk thin where a finger held it for years, a faint wet sheen on the stone, a single object centred on black',
    seed: 4103,
  },
  {
    id: 'clot-fetish', name: 'A knot of old blood', domain: 'blood', accent: 'black-red',
    art: 'a knot of old blood gone hard as a knuckle, black-red and faintly glistening, bound in dark cord, small clotted beads clustered around it, a single object centred on black',
    seed: 4104,
  },
  {
    id: 'crimson-leech', name: 'A crimson leech', domain: 'blood', accent: 'crimson',
    art: 'a fat crimson leech coiled and engorged, glistening wet, fastened to a cracked leather wrist-strap, mouth-parts buried in the leather, a single object centred on black',
    seed: 4105,
  },
  {
    id: 'drowned-heart', name: 'The Drowned Heart', domain: 'blood', accent: 'deep crimson',
    art: 'a waterlogged human heart wrapped in sodden grey funeral cloth, still faintly beating, dark crimson, beads of black water sliding off it, a single object centred on black',
    seed: 4106,
  },
];

/**
 * Relic art specs — the DATA the art pipeline consumes to generate 2.5D relic
 * OBJECT sprites (docs/BUILD-ECONOMY.md "Art direction: one occult world, 2.5D,
 * cheap"; docs/RELICS.md Handoff 1). Same FLUX pipeline as the tarot cards, but
 * a different PRESENTATION: a relic is a single grotesque cursed OBJECT on
 * black (a wrapped talisman, a gorged tick, a sealed heart), NOT a framed card.
 *
 *   delve art relic drowned-heart          generate 1
 *   delve art relic all                    generate EVERY relic (one run each)
 *   delve art relic drowned-heart --n 4    a batch to explore
 *   delve art relic gorged-tick --from r12 --tweak "wetter, more gorged"
 *
 * COVERAGE: every relic in content/items.ts (all 56) has a spec here. To run the
 * FLUX pipeline you need FAL_KEY in .env.local (see scripts/art-backend.ts) — it
 * is NOT set in the web/cloud container, so generation runs on Josh's machine (or
 * any box with the key). Recipe: `delve art relic all` → eyeball runs in the
 * atelier → `delve art promote <id>` the keepers → bake + wire the sprite into
 * the reliquary plate (the plate already leaves that art seam open; see
 * ui/reliquary-screen.ts). Until then the plate shows the 3D thumbnail.
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
  /** Optional extra negative appended to the register's — for a relic FLUX keeps
   *  drifting on (e.g. a small abstract object it renders as a skull). */
  neg?: string;
}

export const RELIC_ART: RelicArtSpec[] = [
  {
    id: 'gorged-tick', name: 'A gorged tick', domain: 'blood', accent: 'dried-blood crimson',
    art: 'a single swollen blood-tick the size of a fist, gorged and glistening, legs curled beneath it, clamped to a shred of grey drained flesh, against a flat chroma-key green screen',
    seed: 4101,
  },
  {
    id: 'weeping-splinter', name: 'A weeping splinter', domain: 'blood', accent: 'crimson',
    art: 'a long splinter of yellowed saint\'s bone, wet at the tip, a single bead of dark blood welling and refusing to clot, bound with a scrap of red thread, against a flat chroma-key green screen',
    seed: 4102,
  },
  {
    id: 'sanguine-ring', name: 'A blood-drinker’s stone', domain: 'blood', accent: 'dark crimson',
    art: 'a dark red gemstone in a worn iron setting, the metal drunk thin where a finger held it for years, a faint wet sheen on the stone, against a flat chroma-key green screen',
    seed: 4103,
  },
  {
    id: 'clot-fetish', name: 'A knot of old blood', domain: 'blood', accent: 'black-red',
    art: 'a knot of old blood gone hard as a knuckle, black-red and faintly glistening, bound in dark cord, small clotted beads clustered around it, against a flat chroma-key green screen',
    seed: 4104,
  },
  {
    id: 'crimson-leech', name: 'A crimson leech', domain: 'blood', accent: 'crimson',
    art: 'a fat crimson leech coiled and engorged, glistening wet, fastened to a cracked leather wrist-strap, mouth-parts buried in the leather, against a flat chroma-key green screen',
    seed: 4105,
  },
  {
    id: 'drowned-heart', name: 'The Drowned Heart', domain: 'blood', accent: 'deep crimson',
    art: 'a waterlogged human heart wrapped in sodden grey funeral cloth, still faintly beating, dark crimson, beads of black water sliding off it, against a flat chroma-key green screen',
    seed: 4106,
  },

  // ── BLOOD (Ysolde's leeching kit + the butcher's ring) ──────────────────────
  {
    id: 'ring-of-bloodthirst', name: "A butcher's thumb-ring", domain: 'blood', accent: 'dried-blood crimson',
    art: "a worn brass butcher's thumb-ring, the metal drunk thin where a thumb rode it, a dark crimson stain worked permanently into the band, against a flat chroma-key green screen",
    seed: 4110,
  },
  {
    id: 'ysolde-leech-glass', name: 'A leech-glass, cracked', domain: 'blood', accent: 'dark crimson',
    art: "a cracked apothecary's leech-glass, a single shrivelled starved leech at the bottom, a crimson residue filming the inside of the glass, against a flat chroma-key green screen",
    seed: 4111,
  },
  {
    id: 'ysolde-tourniquet', name: 'A tourniquet, stiff with old blood', domain: 'blood', accent: 'black-red',
    art: 'a long leather tourniquet strap gone stiff and black with dried blood, its rusted buckle frozen mid-cinch, coiled loosely, against a flat chroma-key green screen',
    seed: 9112,
    neg: 'skull, human skull, face, skeleton, head, bone',
  },
  {
    id: 'ysolde-vein-knife', name: 'Her opened vein-knife', domain: 'blood', accent: 'crimson',
    art: 'a whisper-thin double-edged vein-knife honed almost to nothing, a single bead of fresh dark crimson welling at the point, against a flat chroma-key green screen',
    seed: 4113,
  },

  // ── BONE (grave-iron, marrow, Maren's kept things) ──────────────────────────
  {
    id: 'bone-amulet', name: 'A vertebra on a cord', domain: 'bone', accent: 'cold bone white',
    art: 'a single yellowed human vertebra strung on a knotted leather cord, worn smooth, still holding the curve of a spine, against a flat chroma-key green screen',
    seed: 4200,
  },
  {
    id: 'ring-of-vigor', name: 'A knuckle of the stubborn', domain: 'bone', accent: 'cold bone white',
    art: 'a plain pale ring band carved from a single smooth finger-knuckle bone, a simple round bone ring worn glassy, against a flat chroma-key green screen',
    seed: 3014,
    neg: 'skull, human skull, face, head, teeth, eye socket',
  },
  {
    id: 'ring-of-marrow', name: 'The Marrow-Thief', domain: 'bone', accent: 'bruised bone white',
    art: "a surgeon's ring of hollowed bone, dark marrow welling at its seam, a hair-fine blade set flush inside the band, against a flat chroma-key green screen",
    seed: 4202,
  },
  {
    id: 'ring-of-iron', name: 'A band of grave-iron', domain: 'bone', accent: 'cold grey',
    art: 'a rough ring hammered from a rusted coffin nail, black-scaled iron, the square nail-head still visible where the band closes, against a flat chroma-key green screen',
    seed: 4203,
  },
  {
    id: 'stoneskin-locket', name: 'A locket of grey dust', domain: 'bone', accent: 'ashen grey',
    art: 'a tarnished locket sprung open to a pinch of grey wall-dust packed hard as stone, the hinge itself calcified, against a flat chroma-key green screen',
    seed: 4204,
  },
  {
    id: 'thornring', name: 'A ring of fused barbs', domain: 'bone', accent: 'cold iron grey',
    art: 'a ring of iron barbs fused inward and outward, small hooked thorns bristling from the band, flecked with old rust, against a flat chroma-key green screen',
    seed: 4205,
  },
  {
    id: 'maren-thimble', name: 'A tin thimble', domain: 'bone', accent: 'dull pewter',
    art: 'a dented tin thimble worn thin at the crown, a broken needle still threaded through its dimples with grey gut, against a flat chroma-key green screen',
    seed: 4206,
  },
  {
    id: 'maren-prayer-knot', name: 'A prayer knot', domain: 'bone', accent: 'cold bone white',
    art: 'a short frayed cord tied over and over with dozens of tight desperate knots, grey with handling, against a flat chroma-key green screen',
    seed: 4207,
  },
  {
    id: 'maren-milk-tooth', name: 'A milk tooth, kept', domain: 'bone', accent: 'pale bone white',
    art: "a single small child's milk tooth, kept and polished to an ivory sheen, against a flat chroma-key green screen",
    seed: 9208,
  },

  // ── ROT (grave-mould, plague, Cael's slow dying) ────────────────────────────
  {
    id: 'acid-tongue', name: 'Acid Tongue', domain: 'rot', accent: 'sickly green',
    art: 'a long barbed severed tongue cut from something vast, glistening wet and faintly smoking, acid sizzling and dripping from its barbed length, floating, against a flat chroma-key green screen',
    seed: 9300,
    neg: 'skull, human skull, face, skeleton, head, jaw',
  },
  {
    id: 'grave-mould-clump', name: 'A clump of grave-mould', domain: 'rot', accent: 'sickly green',
    art: 'a clump of pale green-black grave-mould furred with spores, scraped from the underside of a coffin lid, creeping at its edges, against a flat chroma-key green screen',
    seed: 4301,
  },
  {
    id: 'plaguewick', name: 'A wick soaked in bile', domain: 'rot', accent: 'sickly yellow-green',
    art: 'a lamp-wick soaked stiff and yellow-green with old bile, one end charred, a sickly droplet sweating from it, against a flat chroma-key green screen',
    seed: 4302,
  },
  {
    id: 'carrion-tongue', name: "A carrion-bird's tongue", domain: 'rot', accent: 'sickly green',
    art: "a dried blackened carrion-bird's tongue strung on a length of gut, curled and leathery, against a flat chroma-key green screen",
    seed: 4303,
  },
  {
    id: 'cael-black-poultice', name: 'A poultice gone black', domain: 'rot', accent: 'sickly green',
    art: 'a wet wadded cloth poultice gone tar-black and glistening, folded and bound with dark twine, a sickly green weep seeping from its folds, a soft shapeless bundle against a flat chroma-key green screen',
    seed: 9304,
    neg: 'skull, human skull, face, skeleton, bone',
  },
  {
    id: 'cael-grave-earth', name: 'A jar of grave-earth', domain: 'rot', accent: 'sickly green',
    art: 'a small sealed clay jar packed with damp grave-earth, its lid ajar, pale roots threading out of the soil at the rim, against a flat chroma-key green screen',
    seed: 9305,
  },
  {
    id: 'cael-plague-beak', name: 'The plague-mask beak', domain: 'rot', accent: 'sickly green',
    art: 'a long conical leather plague-doctor mask beak, a curved bird-like nose-cone of stitched brown leather, cracked and stuffed with rotted green herbs poking from its tip, two small round glass eye-lenses gone milky at its base, against a flat chroma-key green screen',
    seed: 3015,
    neg: 'skull, human skull, skeleton, real bird, real animal, screaming face, teeth',
  },

  // ── ASH (the ember kept, the martyr burned, Vess's lamps) ───────────────────
  {
    id: 'ring-of-ember', name: 'A coal in silver', domain: 'ash', accent: 'ember orange',
    art: 'a scorched silver ring set with a single live coal that will not die, a low ember glow within, the silver burned black around the setting, against a flat chroma-key green screen',
    seed: 9400,
  },
  {
    id: 'ashen-psalm', name: 'A psalm burned onto slate', domain: 'ash', accent: 'ember orange',
    art: 'a fractured slate tablet, its carved words burned away to smooth glass, a faint heat-glow still living in the cracks, against a flat chroma-key green screen',
    seed: 4401,
  },
  {
    id: 'martyrs-tallow', name: "A candle of martyr's tallow", domain: 'ash', accent: 'ember orange',
    art: 'a squat candle of pale rendered tallow burning with one tall steady flame, the wax weeping down over the shape of a grasping hand, against a flat chroma-key green screen',
    seed: 9402,
  },
  {
    id: 'vess-striker', name: 'A flint striker, thumb-worn', domain: 'ash', accent: 'ember orange',
    art: 'a small steel flint-striker worn bright where a thumb rode it, a fleck of flint clamped in it, a single spark caught leaving the edge, against a flat chroma-key green screen',
    seed: 4403,
  },
  {
    id: 'vess-oil-phial', name: 'A phial of lamp oil', domain: 'ash', accent: 'warm amber',
    art: 'a small stoppered glass phial half-full of amber lamp oil, its cork sealed with wax, a warm glint through the glass, against a flat chroma-key green screen',
    seed: 4404,
  },
  {
    id: 'vess-last-wick', name: 'The last wick', domain: 'ash', accent: 'ember orange',
    art: 'a single short burnt candle-wick stub, just a small charred black thread of string with a faint orange ember glowing at its tip and a thin wisp of smoke, tiny and humble, against a flat chroma-key green screen',
    seed: 3013,
    neg: 'skull, human skull, face, skeleton, bone, teeth, full candle, wax',
  },

  // ── DAWN (the clean light carried down) ─────────────────────────────────────
  {
    id: 'talon-amulet', name: "A falcon's talon", domain: 'dawn', accent: 'radiant pale gold',
    art: "a single curved falcon's talon capped in pale gold, honed to a needle point, catching a clean high light, against a flat chroma-key green screen",
    seed: 4500,
  },
  {
    id: 'jeweler-band', name: 'A lens of pale glass', domain: 'dawn', accent: 'radiant pale gold-white',
    art: "a small brass jeweller's magnifying loupe, a round clear glass lens set in a tarnished brass eyepiece ring with a short knurled handle, an optical instrument, a cold gold-white spark in the lens, against a flat chroma-key green screen",
    seed: 3011,
    neg: 'skull, human skull, face, skeleton, bone, teeth, eye socket',
  },
  {
    id: 'split-iris-amulet', name: 'The Split Iris', domain: 'dawn', accent: 'radiant pale gold-white',
    art: 'a pale human eye set in gold, its iris split cleanly in two down the centre, still glinting with sight, against a flat chroma-key green screen',
    seed: 4502,
  },
  {
    id: 'morningstar-chip', name: 'A chip of the morning star', domain: 'dawn', accent: 'radiant gold-white',
    art: 'a small sharp angular crystal shard, a jagged geometric splinter of pale glowing white-gold mineral like broken quartz, a faceted stone fragment catching cold light, against a flat chroma-key green screen',
    seed: 3012,
    neg: 'skull, human skull, face, skeleton, teeth, flame, fire, mace, morningstar weapon, spiked ball, orb, sphere, round',
  },
  {
    id: 'cleanest-cut', name: 'The cleanest cut', domain: 'dawn', accent: 'radiant white-gold',
    art: 'a thin sliver of mirror-bright sword edge, impossibly keen, a single line of white light running its length, against a flat chroma-key green screen',
    seed: 4504,
  },

  // ── GRACE (the mercy carried against the dark) ──────────────────────────────
  {
    id: 'mendicants-locket', name: "A mendicant's locket", domain: 'grace', accent: 'soft warm amber',
    art: 'a plain worn brass locket hanging open and empty, its hinge soft with handling, a faint warm amber gleam inside, against a flat chroma-key green screen',
    seed: 4600,
  },
  {
    id: 'chime-of-still-air', name: 'A chime of still air', domain: 'grace', accent: 'soft warm amber',
    art: 'a small tarnished silver bell-chime hung on a fine thread, utterly still, a soft amber light held in its cup, against a flat chroma-key green screen',
    seed: 3016,
  },
  {
    id: 'patient-aegis', name: 'A shard of the patient aegis', domain: 'grace', accent: 'soft warm amber',
    art: 'a curved shard of a broken shield-boss, scarred with old blows and worn smooth at the edge, a warm amber sheen on its face, against a flat chroma-key green screen',
    seed: 4602,
  },

  // ── VALOR (the vow that would not kneel — and Aldric's last stand) ──────────
  {
    id: 'ring-of-fury', name: 'A cracked signet', domain: 'valor', accent: 'cold steel silver',
    art: 'a heavy steel signet ring, its crest battered flat and cracked across, the metal bright where it struck stone, against a flat chroma-key green screen',
    seed: 9700,
  },
  {
    id: 'bloodbond-ring', name: 'A vow scratched in iron', domain: 'valor', accent: 'cold steel silver',
    art: 'a plain dark iron band, its whole surface densely scored and cross-hatched with countless fine random scratches, the grooves dark with dried blood, against a flat chroma-key green screen',
    seed: 9701,
    neg: 'text, letters, words, writing, runes, inscription, engraved letters, typography',
  },
  {
    id: 'oath-scrap', name: 'A scrap of a written oath', domain: 'valor', accent: 'pale steel',
    art: 'a torn scrap of vellum bearing a broken line of oath, the rest lost to a dark bloodstain, its edges frayed, against a flat chroma-key green screen',
    seed: 4702,
  },
  {
    id: 'horn-of-the-brink', name: 'A horn cracked at the mouth', domain: 'valor', accent: 'cold steel silver',
    art: 'a war-horn of banded bone and steel split along a crack at the mouth, the fracture rimmed with a thin steel light, against a flat chroma-key green screen',
    seed: 4703,
  },
  {
    id: 'aldric-pauldron-strap', name: 'A dented pauldron strap', domain: 'valor', accent: 'cold steel silver',
    art: 'a thick leather pauldron strap with a battered steel buckle, dented deep where blows kept landing, against a flat chroma-key green screen',
    seed: 4704,
  },
  {
    id: 'aldric-oath-ring', name: 'His notched oath-ring', domain: 'valor', accent: 'cold steel silver',
    art: 'a steel oath-ring nearly worn through, its band chiselled with a row of small notches, a cold silver light on the metal, against a flat chroma-key green screen',
    seed: 4705,
  },
  {
    id: 'aldric-standard', name: 'The standard he would not drop', domain: 'valor', accent: 'pale gold',
    art: 'a broken standard-pole clenched in a severed gauntleted fist, a shred of torn banner still knotted at the top, against a flat chroma-key green screen',
    seed: 4706,
  },

  // ── GREED (the hunger that swallows everything) ─────────────────────────────
  {
    id: 'eye-of-appetite', name: 'Eye of Appetite', domain: 'greed', accent: 'tarnished gold',
    art: 'a lidless golden eye ringed in small teeth, its pupil a black gullet, tarnished gold, staring outward and hungry, against a flat chroma-key green screen',
    seed: 4800,
  },
  {
    id: 'the-long-hunger', name: 'The Long Hunger', domain: 'greed', accent: 'tarnished gold',
    art: 'a gaunt gilded ribcage drawn tight over a hollow, a coin-slot mouth sewn shut with gold wire, tarnished and starved, against a flat chroma-key green screen',
    seed: 4801,
  },
  {
    id: 'beggars-bowl', name: "A beggar's bowl", domain: 'greed', accent: 'tarnished gold',
    art: 'a shallow wooden begging-bowl worn paper-thin at the rim by decades of hands, a single tarnished coin in its cup, against a flat chroma-key green screen',
    seed: 4802,
  },
  {
    id: 'counting-itch', name: 'The counting itch', domain: 'greed', accent: 'tarnished gold',
    art: 'a dried severed finger crooked mid-count, the nail long, a smear of tarnished gold-dust on its tip, against a flat chroma-key green screen',
    seed: 4803,
  },
  {
    id: 'usurers-seal', name: "A usurer's seal", domain: 'greed', accent: 'tarnished gold',
    art: 'a heavy brass debt-seal cut with a coiled serpent-and-coin device, old wax still crusted in the die, tarnished gold, against a flat chroma-key green screen',
    seed: 4804,
  },

  // ── FORBIDDEN (what the deep never once caught) ─────────────────────────────
  {
    id: 'ring-of-quickening', name: 'A ring worn on no finger', domain: 'forbidden', accent: 'arcane violet',
    art: 'a thin dark ring found sewn beneath skin, a film of dried flesh still clinging to it, a faint violet gleam along the band, against a flat chroma-key green screen',
    seed: 4900,
  },
  {
    id: 'frostgrip-amulet', name: 'A shackle-charm of unlight', domain: 'forbidden', accent: 'arcane violet',
    art: 'a small blackened shackle-charm rimed with impossible frost, the ice glinting faint violet, its chain-links fused with cold, against a flat chroma-key green screen',
    seed: 4901,
  },
  {
    id: 'stolen-heel', name: 'A heel-bone, stolen', domain: 'forbidden', accent: 'arcane violet',
    art: 'a single pale heel-bone worn smooth as if still running, a faint violet shimmer of motion around it, against a flat chroma-key green screen',
    seed: 4902,
  },
  {
    id: 'untouched-oath', name: 'The untouched oath', domain: 'forbidden', accent: 'arcane violet',
    art: 'a slip of dark parchment bearing an unbroken oath, utterly unmarked and clean, edged in a faint violet light, against a flat chroma-key green screen',
    seed: 4903,
  },
];

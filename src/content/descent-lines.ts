// What the deep says while the next floor is made (the descent loading screen,
// ui/descent-fade.ts). Its voice, not the place's: the thing below that has
// watched ten thousand delvers and finds you funny (CLAUDE.md, Tone Layering).
//
// Data for the narration layer: add, cut or rewrite lines here; the screen
// picks one at random per descent and never the same twice in a row. A line
// may carry a true hint, but only about something the game really does —
// a hint that lies teaches the player to stop reading.
//
// Rules: one sentence or two, under ~70 characters, no exclamation points,
// no emoji, no modern slang, no mechanics named by their system names.

export const DESCENT_LINES: readonly string[] = [
  'Down, then. They always go down.',
  'I have counted every one of you. You are not the last.',
  'Others came this way. Some of them are still here.',
  'Take everything. You will not carry it far.',
  'Deeper is not safer. It is only deeper.',
  'The stairs go one way. So do you.',
  'The lamp shows you the room. It also shows the room you.',
  'The stone has waited longer than you have. It can wait again.',
  // True hints, in its voice.
  'A light that does not belong is never there to be admired.',   // lighting as signal
  'What is cursed pays first. It collects later.',                // cursed items: an upside, then a price
  'When their eyes go white, meet the blow. It turns aside.',     // deflect on the white flash
  'Rest by a fire. It lends you warmth, and it remembers the loan.', // a fire gives ember: borrowed life
];

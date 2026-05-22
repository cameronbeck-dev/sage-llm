export const PRE_TRIAGE_LABELS = [
  "Checking for new memories",
  "Listening for things worth keeping",
  "Catching the gist",
  "Sifting through this",
  "Reading between the lines",
  "Looking for anything worth saving",
  "Paying attention to the details",
];

export const MEMORY_LABELS = [
  "Saving to memory",
  "Filing this away",
  "Noting this for later",
  "Committing this to heart",
  "Making a note of that",
  "Tucking this into memory",
  "Holding onto that",
];

export const EXISTING_PACK_LABELS = [
  "Saving to **{packName}**",
  "Adding to **{packName}**",
  "Slotting into **{packName}**",
  "Filing under **{packName}**",
  "Dropping this into **{packName}**",
  "Logging it in **{packName}**",
  "Storing in **{packName}**",
];

export const ORPHAN_LABELS = [
  "Putting a pin in this",
  "Tucking this aside",
  "Holding onto this for now",
  "Setting this aside to think about",
  "Bookmarking this",
  "Keeping this one close",
  "Filing this for later",
];

export const CONSOLIDATION_LABELS = [
  "Spotting a pattern",
  "Connecting some dots",
  "Noticing something recurring",
  "Seeing a thread here",
  "Picking up on a theme",
  "Something's forming",
  "This keeps coming up",
];

export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

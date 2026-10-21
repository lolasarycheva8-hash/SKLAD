// jsdom has no native top layer. Its selector engine can recurse indefinitely
// when Floating UI checks :modal / :popover-open during Popper positioning.
// Preserve native matching for every other selector and keep real Radix behavior.
const originalMatches = Element.prototype.matches;
// Keep this until Vitest destroys this isolated jsdom realm: Floating UI can
// finish queued positioning work after afterAll, so restoring earlier rehangs.
Element.prototype.matches = function (selector: string) {
  if (selector === ":modal" || selector === ":popover-open") return false;
  return originalMatches.call(this, selector);
};
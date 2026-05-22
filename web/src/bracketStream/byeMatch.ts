import type { BracketMatch } from 'ttc-tornooiapp';
import { isBracketByeWalkoverMatch } from 'ttc-tornooiapp';

export { isBracketByeWalkoverMatch };

export function bracketMatchHiddenInStream(m: BracketMatch): boolean {
  return isBracketByeWalkoverMatch(m);
}

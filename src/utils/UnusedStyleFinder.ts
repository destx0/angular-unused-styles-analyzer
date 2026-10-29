import { UnusedStyle, SelectorPosition } from '../types/ComponentInterfaces';
import { SelectorMatcher } from './SelectorMatcher';
import { DEFAULT_IGNORED_SELECTORS } from './IgnoredSelectors';

export class UnusedStyleFinder {
    private selectorMatcher = new SelectorMatcher();
    
    findUnusedStyles(
        cssSelectors: Map<string, SelectorPosition>,
        usedSelectors: Set<string>,
        ignoredSelectors: string[] = DEFAULT_IGNORED_SELECTORS
    ): UnusedStyle[] {
        const unused: UnusedStyle[] = [];
        
        for (const [selector, position] of cssSelectors.entries()) {
            if (this.selectorMatcher.shouldIgnoreSelector(selector, ignoredSelectors)) {
                continue;
            }
            
            if (!this.selectorMatcher.isSelectorUsed(selector, usedSelectors)) {
                unused.push({
                    selector,
                    line: position.line,
                    character: position.character,
                    length: position.length,
                    reason: `Style '${selector}' appears to be unused`
                });
            }
        }
        
        return unused;
    }
}

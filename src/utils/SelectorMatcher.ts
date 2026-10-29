import { matchesIgnoredSelector } from './IgnoredSelectors';

export class SelectorMatcher {
    isSelectorUsed(cssSelector: string, usedSelectors: Set<string>): boolean {
        // Clean the CSS selector for comparison
        const cleanSelector = this.cleanCSSSelector(cssSelector);

        // For nested selectors only the subject (rightmost compound) decides
        // whether the rule can apply, e.g. `.card .title` needs `.title`.
        const subject = this.getSubjectSelector(cleanSelector);
        const subjectNames = this.extractClassAndIdNames(subject);

        if (subjectNames.length > 0) {
            return subjectNames.every(name => this.hasUsedSelector(name, usedSelectors));
        }

        // No class or ID in the subject (element, universal, :host...). Fall
        // back to any class/ID in the selector, or treat it as used when the
        // selector cannot be resolved at all.
        const allNames = this.extractClassAndIdNames(cleanSelector);
        return allNames.length === 0 || allNames.every(name => this.hasUsedSelector(name, usedSelectors));
    }

    shouldIgnoreSelector(selector: string, ignoredSelectors: string[]): boolean {
        return matchesIgnoredSelector(selector, ignoredSelectors);
    }

    private cleanCSSSelector(selector: string): string {
        // Remove pseudo-classes, pseudo-elements, and complex selectors
        return selector
            .replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '') // Remove pseudo-classes/elements
            .replace(/\s*[>+~]\s*/g, ' ') // Simplify combinators
            .replace(/\[.*?\]/g, '') // Remove attribute selectors
            .trim();
    }

    private getSubjectSelector(cleanSelector: string): string {
        const parts = cleanSelector.split(/\s+/).filter(Boolean);
        return parts.length > 0 ? parts[parts.length - 1] : '';
    }

    private extractClassAndIdNames(selector: string): string[] {
        const classes = selector.match(/\.[a-zA-Z_-][a-zA-Z0-9_-]*/g) || [];
        const ids = selector.match(/#[a-zA-Z_-][a-zA-Z0-9_-]*/g) || [];

        return [...classes, ...ids].map(name => name.substring(1));
    }

    private hasUsedSelector(name: string, usedSelectors: Set<string>): boolean {
        if (usedSelectors.has(name)) {
            return true;
        }

        // Some detectors record whitespace-separated class lists as one entry.
        for (const used of usedSelectors) {
            if (used.split(/\s+/).includes(name)) {
                return true;
            }
        }

        return false;
    }
}

/**
 * Angular wrappers whose rules (and everything nested inside them) should not
 * be reported as unused.
 */
export const DEFAULT_IGNORED_SELECTORS = [
    '::ng-deep',
    ':host',
    ':host-context',
    ':host(.*)',
    '/deep/',
    '>>>'
];

// Metacharacters that indicate a configured pattern is meant to be a regex.
// A plain "." is not included so common literal selectors keep exact matching.
const REGEX_METACHARACTERS = /[\\^$*+?()[\]{}|]/;

const regexCache = new Map<string, RegExp | null>();

function getRegExp(pattern: string): RegExp | null {
    if (regexCache.has(pattern)) {
        return regexCache.get(pattern) ?? null;
    }

    let regex: RegExp | null = null;
    try {
        regex = new RegExp(pattern);
    } catch {
        regex = null;
    }

    regexCache.set(pattern, regex);
    return regex;
}

export function matchesIgnoredSelector(selector: string, ignoredSelectors: string[]): boolean {
    return ignoredSelectors.some(ignored => {
        if (!ignored) {
            return false;
        }

        if (selector.includes(ignored)) {
            return true;
        }

        if (!REGEX_METACHARACTERS.test(ignored)) {
            return false;
        }

        const regex = getRegExp(ignored);
        return regex !== null && regex.test(selector);
    });
}

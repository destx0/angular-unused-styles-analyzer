import type { SelectorPosition } from '../types/ComponentInterfaces';
import { DEFAULT_IGNORED_SELECTORS, matchesIgnoredSelector } from '../utils/IgnoredSelectors';

/**
 * Minimal shape of a text document. vscode.TextDocument satisfies it, which
 * keeps the parsing logic unit-testable without the VS Code runtime.
 */
export interface TextDocumentLike {
    getText(): string;
}

type SkipReason = 'none' | 'ignored-wrapper' | 'definition';

interface BlockFrame {
    /** Selectors that nested rules should resolve against. */
    parentSelectors: string[];
    /** Why selectors inside this block are skipped. */
    skipReason: SkipReason;
}

interface SelectorSegment {
    text: string;
    /** Offset of the segment within the prelude. */
    start: number;
}

/**
 * At-rules whose block contents are definitions rather than style rules.
 * Their bodies must not be reported as unused selectors.
 */
const SKIPPED_AT_RULES = new Set([
    'mixin',
    'function',
    'keyframes',
    '-webkit-keyframes',
    '-moz-keyframes',
    '-o-keyframes',
    'font-face',
    'font-palette-values',
    'font-feature-values',
    'page',
    'property',
    'counter-style',
    'viewport',
    '-ms-viewport',
]);

export class CSSAnalyzer {
    extractSelectors(
        document: TextDocumentLike,
        ignoredSelectors: string[] = DEFAULT_IGNORED_SELECTORS
    ): Map<string, SelectorPosition> {
        const selectors = new Map<string, SelectorPosition>();

        // Normalize line endings so positions map to real document lines.
        const text = document.getText().replace(/\r\n?/g, '\n');
        this.parseStylesheet(text, selectors, ignoredSelectors);

        return selectors;
    }

    private parseStylesheet(
        text: string,
        selectors: Map<string, SelectorPosition>,
        ignoredSelectors: string[]
    ) {
        const frames: BlockFrame[] = [];

        let buffer = '';
        let bufferLines: number[] = [];
        let bufferCharacters: number[] = [];
        let index = 0;
        let line = 0;
        let character = 0;
        let parenDepth = 0;
        let bracketDepth = 0;
        let quote: string | null = null;
        let inLineComment = false;
        let inBlockComment = false;

        const advance = () => {
            if (text[index] === '\n') {
                index++;
                line++;
                character = 0;
            } else {
                index++;
                character++;
            }
        };

        const appendCurrent = () => {
            buffer += text[index];
            bufferLines.push(line);
            bufferCharacters.push(character);
            advance();
        };

        const appendSeparator = () => {
            if (buffer.length > 0 && !/\s$/.test(buffer)) {
                buffer += ' ';
                bufferLines.push(line);
                bufferCharacters.push(character);
            }
        };

        const resetBuffer = () => {
            buffer = '';
            bufferLines = [];
            bufferCharacters = [];
        };

        const currentFrame = (): BlockFrame | undefined => frames[frames.length - 1];
        const currentSkipReason = (): SkipReason => currentFrame()?.skipReason ?? 'none';
        const currentParentSelectors = (): string[] => currentFrame()?.parentSelectors ?? [];

        const handleBlock = () => {
            const rawPrelude = buffer.trim();
            const preludeStart = buffer.length - buffer.trimStart().length;
            const preludeLines = bufferLines;
            const preludeCharacters = bufferCharacters;
            resetBuffer();

            if (!rawPrelude) {
                frames.push({
                    parentSelectors: currentParentSelectors(),
                    skipReason: currentSkipReason()
                });
                return;
            }

            // At-rules never become selectors themselves. Transparent wrappers
            // such as @media and @include pass their parent context through.
            const atRule = /^@([\w-]+)/.exec(rawPrelude);
            if (atRule) {
                const name = atRule[1].toLowerCase();

                if (SKIPPED_AT_RULES.has(name)) {
                    frames.push({ parentSelectors: [], skipReason: 'definition' });
                    return;
                }

                // Mixin and keyframe bodies stay skipped all the way down.
                if (currentSkipReason() === 'definition') {
                    frames.push({ parentSelectors: [], skipReason: 'definition' });
                    return;
                }

                // Conditional wrappers are analyzed even when they live inside
                // an ignored :host or ::ng-deep block. Dropping the ignored
                // parent keeps their selectors from being skipped too.
                frames.push({
                    parentSelectors: currentSkipReason() === 'ignored-wrapper'
                        ? []
                        : currentParentSelectors(),
                    skipReason: 'none'
                });
                return;
            }

            const inheritedSkipReason = currentSkipReason();
            if (inheritedSkipReason !== 'none') {
                frames.push({ parentSelectors: [], skipReason: inheritedSkipReason });
                return;
            }

            const parents = currentParentSelectors();
            const resolvedSelectors: string[] = [];
            let foundSelector = false;

            for (const segment of this.splitSelectorList(rawPrelude)) {
                const selector = this.normalizeSelector(segment.text);
                if (!this.isValidSelector(selector)) {
                    continue;
                }

                foundSelector = true;

                const leadingWhitespace = segment.text.length - segment.text.trimStart().length;
                const offset = preludeStart + segment.start + leadingWhitespace;
                const position = {
                    line: preludeLines[offset] ?? 0,
                    character: preludeCharacters[offset] ?? 0
                };

                for (const resolvedSelector of this.resolveSelector(selector, parents)) {
                    if (matchesIgnoredSelector(resolvedSelector, ignoredSelectors)) {
                        continue;
                    }

                    if (!selectors.has(resolvedSelector)) {
                        selectors.set(resolvedSelector, {
                            line: position.line,
                            character: position.character,
                            length: segment.text.trim().length
                        });
                    }
                    resolvedSelectors.push(resolvedSelector);
                }
            }

            // An ignored wrapper such as :host or ::ng-deep suppresses direct
            // nested rules, while @media/@include escape via the at-rule path.
            if (foundSelector && resolvedSelectors.length === 0) {
                frames.push({ parentSelectors: [], skipReason: 'ignored-wrapper' });
                return;
            }

            frames.push({
                parentSelectors: resolvedSelectors.length > 0 ? resolvedSelectors : parents,
                skipReason: 'none'
            });
        };

        const handleClose = () => {
            frames.pop();
            resetBuffer();
        };

        while (index < text.length) {
            const ch = text[index];
            const next = text[index + 1];

            if (inLineComment) {
                if (ch === '\n') {
                    inLineComment = false;
                }
                advance();
                continue;
            }

            if (inBlockComment) {
                if (ch === '*' && next === '/') {
                    index += 2;
                    character += 2;
                    inBlockComment = false;
                } else {
                    advance();
                }
                continue;
            }

            if (quote) {
                if (ch === '\\') {
                    appendCurrent();
                    if (index < text.length) {
                        appendCurrent();
                    }
                    continue;
                }

                appendCurrent();
                if (ch === quote) {
                    quote = null;
                }
                continue;
            }

            if (ch === '"' || ch === "'") {
                quote = ch;
                appendCurrent();
                continue;
            }

            if (ch === '/' && next === '*') {
                appendSeparator();
                index += 2;
                character += 2;
                inBlockComment = true;
                continue;
            }

            // Don't mistake protocol separators such as https:// for comments.
            if (ch === '/' && next === '/' && parenDepth === 0 && bracketDepth === 0) {
                appendSeparator();
                index += 2;
                character += 2;
                inLineComment = true;
                continue;
            }

            // SCSS interpolation braces are part of the selector, not a block.
            if (ch === '#' && next === '{') {
                appendCurrent();
                appendCurrent();
                let interpolationDepth = 1;
                while (index < text.length && interpolationDepth > 0) {
                    const current = text[index];
                    if (current === '{') {
                        interpolationDepth++;
                    } else if (current === '}') {
                        interpolationDepth--;
                    }
                    appendCurrent();
                }
                continue;
            }

            if (ch === '(') {
                parenDepth++;
                appendCurrent();
                continue;
            }

            if (ch === ')') {
                parenDepth = Math.max(0, parenDepth - 1);
                appendCurrent();
                continue;
            }

            if (ch === '[') {
                bracketDepth++;
                appendCurrent();
                continue;
            }

            if (ch === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
                appendCurrent();
                continue;
            }

            if (parenDepth === 0 && bracketDepth === 0) {
                if (ch === '{') {
                    handleBlock();
                    advance();
                    continue;
                }

                if (ch === '}') {
                    handleClose();
                    advance();
                    continue;
                }

                if (ch === ';') {
                    resetBuffer();
                    advance();
                    continue;
                }
            }

            appendCurrent();
        }
    }

    private splitSelectorList(prelude: string): SelectorSegment[] {
        const segments: SelectorSegment[] = [];
        let start = 0;
        let parenDepth = 0;
        let bracketDepth = 0;
        let quote: string | null = null;

        for (let i = 0; i < prelude.length; i++) {
            const ch = prelude[i];

            if (quote) {
                if (ch === '\\') {
                    i++;
                } else if (ch === quote) {
                    quote = null;
                }
                continue;
            }

            if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (ch === '(') {
                parenDepth++;
            } else if (ch === ')') {
                parenDepth = Math.max(0, parenDepth - 1);
            } else if (ch === '[') {
                bracketDepth++;
            } else if (ch === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
            } else if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
                segments.push({ text: prelude.slice(start, i), start });
                start = i + 1;
            }
        }

        segments.push({ text: prelude.slice(start), start });
        return segments;
    }

    private normalizeSelector(selector: string): string {
        return selector.replace(/\s+/g, ' ').trim();
    }

    private resolveSelector(selector: string, parents: string[]): string[] {
        if (parents.length === 0) {
            // A conditional block may have escaped an ignored :host wrapper,
            // so resolve a leftover & against nothing.
            const resolved = selector.replace(/&/g, '').replace(/\s+/g, ' ').trim();
            return resolved ? [resolved] : [];
        }

        const resolved: string[] = [];
        for (const parent of parents) {
            if (selector.includes('&')) {
                resolved.push(selector.replace(/&/g, parent));
            } else {
                resolved.push(`${parent} ${selector}`);
            }
        }
        return resolved;
    }

    private isValidSelector(selector: string): boolean {
        if (!selector) {
            return false;
        }

        // SCSS placeholders are not emitted as real selectors on their own.
        if (selector.startsWith('%')) {
            return false;
        }

        // Nested property blocks look like selectors but end with a colon.
        if (selector.endsWith(':')) {
            return false;
        }

        // Keyframe offsets and element names that start with a digit.
        if (/^\d/.test(selector)) {
            return false;
        }

        return true;
    }
}

import * as assert from 'assert';
import { CSSAnalyzer } from '../analyzer/CSSAnalyzer';
import { SelectorMatcher } from '../utils/SelectorMatcher';
import { UnusedStyleFinder } from '../utils/UnusedStyleFinder';
import { DEFAULT_IGNORED_SELECTORS, matchesIgnoredSelector } from '../utils/IgnoredSelectors';

function analyze(scss: string): Map<string, { line: number; character: number; length: number }> {
    return new CSSAnalyzer().extractSelectors({ getText: () => scss });
}

function selectorNames(scss: string): string[] {
    return [...analyze(scss).keys()];
}

describe('CSSAnalyzer', () => {
    describe('breakpoint mixins and at-rules', () => {
        it('extracts selectors from a top-level breakpoint @include block', () => {
            const scss = `
@use 'breakpoints' as bp;

.card {
  color: red;
}

@include bp.breakpoint-mixin(mobile) {
  .mobile-only {
    display: none;
  }

  .also-mobile {
    color: blue;
  }
}
`;

            assert.deepStrictEqual(
                selectorNames(scss).sort(),
                ['.also-mobile', '.card', '.mobile-only']
            );
        });

        it('extracts selectors from a custom breakpoint at-rule block', () => {
            const scss = `
@breakpoint-mixin(mobile) {
  .custom-breakpoint-only {
    color: red;
  }
}
`;

            assert.deepStrictEqual(selectorNames(scss), ['.custom-breakpoint-only']);
        });

        it('extracts selectors from a nested breakpoint include and resolves &', () => {
            const scss = `
.card {
  color: red;

  @include breakpoint-mixin(mobile) {
    &--mobile { color: blue; }
    .title { font-size: 12px; }
    &.active { color: green; }
  }
}
`;

            assert.deepStrictEqual(
                selectorNames(scss).sort(),
                ['.card', '.card .title', '.card--mobile', '.card.active']
            );
        });

        it('extracts selectors from @media blocks', () => {
            const scss = `
@media (max-width: 767px) {
  .media-mobile-only { color: blue; }

  .card {
    .title { color: red; }
  }
}
`;

            assert.deepStrictEqual(
                selectorNames(scss).sort(),
                ['.card', '.card .title', '.media-mobile-only']
            );
        });

        it('extracts selectors from @supports blocks nested in a rule', () => {
            const scss = `
.card {
  @supports (display: grid) {
    .grid { display: grid; }
  }
}
`;

            assert.deepStrictEqual(
                selectorNames(scss).sort(),
                ['.card', '.card .grid']
            );
        });

        it('does not treat mixin definitions as component styles', () => {
            const scss = `
@mixin breakpoint-mixin($size) {
  @media (max-width: 767px) {
    @content;
  }

  .generated-by-mixin {
    color: red;
  }
}
`;

            assert.deepStrictEqual(selectorNames(scss), []);
        });

        it('does not report keyframe selectors', () => {
            const scss = `
@keyframes spin {
  from { transform: rotate(0deg); }
  50% { transform: rotate(180deg); }
  to { transform: rotate(360deg); }
}
`;

            assert.deepStrictEqual(selectorNames(scss), []);
        });
    });

    describe('Angular host and deep selectors', () => {
        it('skips direct rules but analyzes media and breakpoint blocks inside :host', () => {
            const scss = `
:host {
  display: block;
  .unused-in-host { color: red; }

  ::ng-deep {
    .unused-in-deep { color: blue; }
  }

  @media (max-width: 600px) {
    .unused-in-media { color: green; }
  }

  @include bp(mobile) {
    .unused-in-include { color: black; }
  }
}
`;

            assert.deepStrictEqual(
                selectorNames(scss).sort(),
                ['.unused-in-include', '.unused-in-media']
            );
        });

        it('resolves & when a conditional block escapes an ignored wrapper', () => {
            const scss = `:host { @media (max-width: 600px) { &.active { color: red; } } }`;

            assert.deepStrictEqual(selectorNames(scss), ['.active']);
        });

        it('skips top-level ::ng-deep, /deep/, and >>> blocks', () => {
            const scss = `
::ng-deep {
  .unused-in-deep { color: red; }
}

:host(.active) {
  .unused-in-host { color: blue; }
}

:host-context(.dark) {
  .unused-in-context { color: green; }
}

:host /deep/ .unused-deep { color: black; }

>>> .unused-old-deep { color: gray; }
`;

            assert.deepStrictEqual(selectorNames(scss), []);
        });

        it('analyzes media blocks nested in top-level ::ng-deep', () => {
            const scss = `
::ng-deep {
  @media (max-width: 600px) {
    .unused-deep-media { color: red; }
  }
}
`;

            assert.deepStrictEqual(selectorNames(scss), ['.unused-deep-media']);
        });

        it('still analyzes normal rules next to host rules', () => {
            const scss = `
:host {
  .unused-in-host { color: red; }
}

.normal {
  .unused-normal { color: blue; }
}
`;

            assert.deepStrictEqual(
                selectorNames(scss).sort(),
                ['.normal', '.normal .unused-normal']
            );
        });

        it('keeps the non-ignored branch of a mixed selector list', () => {
            const scss = `
:host, .button {
  .unused { color: red; }
}
`;

            assert.deepStrictEqual(
                selectorNames(scss).sort(),
                ['.button', '.button .unused']
            );
        });

        it('can opt back in by passing an empty ignore list', () => {
            const scss = `:host { .unused-in-host { color: red; } }`;
            const selectors = new CSSAnalyzer().extractSelectors({ getText: () => scss }, []);

            assert.deepStrictEqual([...selectors.keys()], [':host', ':host .unused-in-host']);
        });
    });

    describe('unused style reporting with ignored wrappers', () => {
        const finder = new UnusedStyleFinder();

        function unusedSelectors(scss: string, used: string[] = []): string[] {
            const selectors = new CSSAnalyzer().extractSelectors({ getText: () => scss });
            return finder
                .findUnusedStyles(selectors, new Set(used))
                .map(style => style.selector);
        }

        it('reports nothing inside :host or ::ng-deep', () => {
            const scss = `
:host {
  .frame { color: red; }

  ::ng-deep {
    .child { color: blue; }
  }
}
`;

            assert.deepStrictEqual(unusedSelectors(scss), []);
        });

        it('reports normal unused rules beside host rules', () => {
            const scss = `
:host {
  .frame { color: red; }
}

.normal {
  .unused { color: blue; }
}
`;

            assert.deepStrictEqual(unusedSelectors(scss, ['normal']), ['.normal .unused']);
        });

        it('reports the non-host branch of a mixed selector list', () => {
            const scss = `
:host, .button {
  .unused { color: red; }
}
`;

            assert.deepStrictEqual(unusedSelectors(scss, ['button']), ['.button .unused']);
        });

        it('reports unused rules inside media queries and breakpoint includes under :host', () => {
            const scss = `
:host {
  @media (max-width: 600px) {
    .mobile-unused { color: red; }
  }

  @include bp(mobile) {
    .breakpoint-unused { color: blue; }
  }
}
`;

            assert.deepStrictEqual(
                unusedSelectors(scss).sort(),
                ['.breakpoint-unused', '.mobile-unused']
            );
        });

        it('reports unused rules inside media queries under ::ng-deep', () => {
            const scss = `
::ng-deep {
  @media (max-width: 600px) {
    .deep-media-unused { color: red; }
  }
}
`;

            assert.deepStrictEqual(unusedSelectors(scss), ['.deep-media-unused']);
        });

        it('still skips @mixin definitions, including their media queries', () => {
            const scss = `
@mixin bp() {
  @media (max-width: 600px) {
    .generated-by-mixin { color: red; }
  }
}
`;

            assert.deepStrictEqual(unusedSelectors(scss), []);
        });
    });

    describe('parsing', () => {
        it('splits selector lists into individual selectors', () => {
            const scss = `
.card,
.panel {
  color: red;
}
`;

            const selectors = analyze(scss);
            assert.deepStrictEqual([...selectors.keys()], ['.card', '.panel']);
            assert.deepStrictEqual(selectors.get('.panel'), {
                line: 2,
                character: 0,
                length: 6
            });
        });

        it('does not split commas inside pseudo-class arguments', () => {
            const scss = `:is(.card, .panel) .title { color: red; }`;

            assert.deepStrictEqual(selectorNames(scss), [':is(.card, .panel) .title']);
        });

        it('ignores braces in strings, comments, and URLs', () => {
            const scss = `
.card {
  content: "}";
  background: url(https://example.com/a.png);

  // } pretend the rule ended here
  /* } another fake closing brace */
  .title { color: red; }
}

.after { color: blue; }
`;

            assert.deepStrictEqual(
                selectorNames(scss).sort(),
                ['.after', '.card', '.card .title']
            );
        });

        it('handles SCSS interpolation without opening a block', () => {
            const scss = `
.icon-#{$name} {
  color: red;
}

.after { color: blue; }
`;

            assert.deepStrictEqual(
                selectorNames(scss).sort(),
                ['.after', '.icon-#{$name}']
            );
        });

        it('ignores nested property blocks', () => {
            const scss = `
.card {
  font: {
    family: serif;
  }

  .title { color: red; }
}
`;

            assert.deepStrictEqual(
                selectorNames(scss).sort(),
                ['.card', '.card .title']
            );
        });

        it('reports source positions for selectors inside breakpoints', () => {
            const scss = [
                '.card {',
                '  @include breakpoint-mixin(mobile) {',
                '    .title {',
                '      color: red;',
                '    }',
                '  }',
                '}'
            ].join('\n');

            const selectors = analyze(scss);
            assert.deepStrictEqual(selectors.get('.card .title'), {
                line: 2,
                character: 4,
                length: 6
            });
        });
    });

    describe('unused detection for breakpoint styles', () => {
        const matcher = new SelectorMatcher();

        it('flags a class that only exists inside a top-level breakpoint block', () => {
            const scss = `
@include bp.breakpoint-mixin(mobile) {
  .mobile-only {
    display: none;
  }
}
`;

            const unused = [...analyze(scss).keys()]
                .filter(selector => !matcher.isSelectorUsed(selector, new Set<string>()));

            assert.deepStrictEqual(unused, ['.mobile-only']);
        });

        it('flags a nested breakpoint class when its subject is unused', () => {
            const scss = `
.card {
  @include bp.breakpoint-mixin(mobile) {
    .title { color: red; }
  }
}
`;

            const selectors = analyze(scss);
            assert.ok(selectors.has('.card .title'));
            assert.strictEqual(
                matcher.isSelectorUsed('.card .title', new Set(['card'])),
                false
            );
        });

        it('keeps a nested breakpoint class when its subject is used', () => {
            assert.strictEqual(
                new SelectorMatcher().isSelectorUsed('.card .title', new Set(['card', 'title'])),
                true
            );
        });
    });
});

describe('SelectorMatcher', () => {
    const matcher = new SelectorMatcher();

    it('uses the rightmost compound selector for nested rules', () => {
        assert.strictEqual(matcher.isSelectorUsed('.card .unused', new Set(['card'])), false);
        assert.strictEqual(matcher.isSelectorUsed('.card .used', new Set(['card', 'used'])), true);
    });

    it('requires all classes in the subject compound', () => {
        assert.strictEqual(matcher.isSelectorUsed('.card.active', new Set(['card'])), false);
        assert.strictEqual(
            matcher.isSelectorUsed('.card.active', new Set(['card', 'active'])),
            true
        );
    });

    it('matches classes and ids exactly', () => {
        assert.strictEqual(matcher.isSelectorUsed('.card', new Set(['card'])), true);
        assert.strictEqual(matcher.isSelectorUsed('.card', new Set(['card-wrapper'])), false);
        assert.strictEqual(matcher.isSelectorUsed('#app .panel', new Set(['app', 'panel'])), true);
        assert.strictEqual(matcher.isSelectorUsed('#app .panel', new Set(['app'])), false);
    });

    it('treats selectors without a class or id as used', () => {
        assert.strictEqual(matcher.isSelectorUsed('h1', new Set()), true);
        assert.strictEqual(matcher.isSelectorUsed('*', new Set()), true);
    });
});

describe('ignored selector matching', () => {
    it('matches the default Angular host and deep patterns', () => {
        const selectors = [
            ':host',
            ':host .frame',
            ':host(.active) .frame',
            ':host-context(.dark) .frame',
            '::ng-deep .child',
            ':host ::ng-deep .child',
            '/deep/ .child',
            '>>> .child'
        ];

        for (const selector of selectors) {
            assert.strictEqual(
                matchesIgnoredSelector(selector, DEFAULT_IGNORED_SELECTORS),
                true,
                selector
            );
        }
    });

    it('does not match ordinary selectors', () => {
        assert.strictEqual(
            matchesIgnoredSelector('.normal .unused', DEFAULT_IGNORED_SELECTORS),
            false
        );
        assert.strictEqual(
            matchesIgnoredSelector('.my-host', DEFAULT_IGNORED_SELECTORS),
            false
        );
    });

    it('supports regex patterns without treating plain dots as wildcards', () => {
        assert.strictEqual(matchesIgnoredSelector('.legacy-widget', ['^\\.legacy-']), true);
        assert.strictEqual(matchesIgnoredSelector('xlegacy-widget', ['^\\.legacy-']), false);
        assert.strictEqual(matchesIgnoredSelector('xfoo', ['.foo']), false);
    });
});

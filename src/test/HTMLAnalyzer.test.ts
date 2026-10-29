import * as assert from 'assert';
import { HTMLAnalyzer } from '../analyzer/HTMLAnalyzer';

type DocumentLike = Parameters<HTMLAnalyzer['extractUsedSelectors']>[0];

function extract(html: string): Set<string> {
    return new HTMLAnalyzer().extractUsedSelectors({
        getText: () => html
    } as unknown as DocumentLike);
}

function names(html: string): string[] {
    return [...extract(html)].sort();
}

describe('HTMLAnalyzer', () => {
    it('extracts static classes and ids', () => {
        const html = `<div class="foo bar" id="main"></div>`;

        assert.deepStrictEqual(names(html), ['bar', 'foo', 'main']);
    });

    it('extracts [class.foo] bindings', () => {
        assert.deepStrictEqual(
            names(`<div [class.active]="isActive"></div>`),
            ['active']
        );
    });

    it('extracts [class] object binding keys', () => {
        const html = `<label
  for="taxFreeAll"
  class="nest-radio-input-wrapper input-border"
  [class]="{
    'input-checked': taxFreeControl['typeOfTaxFreeAmount'].value === selectionValues.FULL_TFC,
    'nest-error-border': transferInValidation ||
      (taxFreeControl['typeOfTaxFreeAmount'].invalid &&
       taxFreeControl['typeOfTaxFreeAmount'].touched)
  }">
</label>`;

        const used = extract(html);

        assert.ok(used.has('nest-radio-input-wrapper'));
        assert.ok(used.has('input-border'));
        assert.ok(used.has('input-checked'));
        assert.ok(used.has('nest-error-border'));
        assert.ok(!used.has('typeOfTaxFreeAmount'));
    });

    it('extracts unquoted [class] object keys', () => {
        assert.deepStrictEqual(
            names(`<div [class]="{active: isActive, disabled: isDisabled}"></div>`),
            ['active', 'disabled']
        );
    });

    it('extracts classes from [class] string expressions', () => {
        assert.deepStrictEqual(
            names(`<div [class]="isError ? 'error-border' : 'normal'"></div>`),
            ['error-border', 'normal']
        );
    });

    it('extracts [ngClass] object bindings with inner single quotes', () => {
        const html = `<div [ngClass]="{'has-error': invalid, 'is-open': open}"></div>`;

        assert.deepStrictEqual(names(html), ['has-error', 'is-open']);
    });

    it('extracts [ngClass] array and ternary classes', () => {
        const html = `<div [ngClass]="['base', isActive ? 'active' : 'inactive']"></div>`;

        assert.deepStrictEqual(names(html), ['active', 'base', 'inactive']);
    });

    it('does not treat data-id as an id attribute', () => {
        assert.deepStrictEqual(names(`<div data-id="user-1"></div>`), []);
    });
});

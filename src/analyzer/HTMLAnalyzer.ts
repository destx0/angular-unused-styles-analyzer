import type * as vscode from 'vscode';

export class HTMLAnalyzer {
    extractUsedSelectors(document: vscode.TextDocument): Set<string> {
        const usedSelectors = new Set<string>();
        const text = document.getText();

        // Static class attributes
        for (const match of text.matchAll(/(?:^|\s)class\s*=\s*(["'])([\s\S]*?)\1/g)) {
            this.addClassNames(match[2], usedSelectors);
        }

        // Static id attributes
        for (const match of text.matchAll(/(?:^|\s)id\s*=\s*(["'])([\s\S]*?)\1/g)) {
            this.addClassNames(match[2], usedSelectors);
        }

        // Angular [class.foo] bindings
        for (const match of text.matchAll(/\[class\.([^\]]+)\]/g)) {
            this.addClassNames(match[1], usedSelectors);
        }

        // Angular [class] and [ngClass] bindings
        for (const match of text.matchAll(/\[(?:class|ngClass)\]\s*=\s*(["'])([\s\S]*?)\1/g)) {
            this.extractBindingClasses(match[2], usedSelectors);
        }

        return usedSelectors;
    }

    private extractBindingClasses(expression: string, usedSelectors: Set<string>) {
        const trimmed = expression.trim();

        // Object form: { 'is-error': condition, active: condition }
        if (trimmed.startsWith('{')) {
            this.extractObjectKeys(trimmed, usedSelectors);
            return;
        }

        // String/array/ternary form: 'foo bar', ['foo', condition ? 'bar' : '']
        this.extractStringLiterals(trimmed, usedSelectors);
    }

    private extractObjectKeys(expression: string, usedSelectors: Set<string>) {
        const keyPattern = /(?:^|[{,]\s*)(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$-]*))\s*:/g;

        for (const match of expression.matchAll(keyPattern)) {
            const className = match[1] ?? match[2];
            if (className) {
                this.addClassNames(className, usedSelectors);
            }
        }
    }

    private extractStringLiterals(expression: string, usedSelectors: Set<string>) {
        const literalPattern = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;

        for (const match of expression.matchAll(literalPattern)) {
            const start = match.index ?? 0;
            const end = start + match[0].length;

            // Ignore property access such as obj['typeOfTaxFreeAmount'].
            if (expression[start - 1] === '[' && expression[end] === ']') {
                continue;
            }

            this.addClassNames(match[2], usedSelectors);
        }
    }

    private addClassNames(value: string, usedSelectors: Set<string>) {
        for (const className of value.split(/\s+/)) {
            const trimmed = className.trim();
            if (trimmed && !trimmed.includes('{{') && !trimmed.includes('}}')) {
                usedSelectors.add(trimmed);
            }
        }
    }
}

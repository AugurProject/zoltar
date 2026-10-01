import { expect, test } from 'bun:test'
import { h } from 'preact'
import { renderStaticMarkup } from '../src/dashboard/static-markup.ts'

test('static markup escapes attribute quotes and line breaks so multi-line placeholders stay on one source line', () => {
	expect(renderStaticMarkup(h('textarea', { placeholder: 'One "ID" per line:\nopen-oracle.weth.wrap & more', rows: 5, spellcheck: false }))).toBe('<textarea placeholder="One &quot;ID&quot; per line:&#10;open-oracle.weth.wrap &amp; more" rows="5" spellcheck="false"></textarea>')
})

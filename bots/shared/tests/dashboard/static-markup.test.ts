import { expect, test } from 'bun:test'
import { Component, Fragment, h } from 'preact'
import { RawMarkup, renderStaticMarkup } from '../../src/dashboard/static-markup.ts'

test('renders elements, components, and fragments with escaped text and attributes', () => {
	const Label = ({ text }: { text: string }) => h('span', { class: 'label' }, text)
	const markup = renderStaticMarkup(
		h(
			Fragment,
			null,
			h('p', { id: 'a', title: 'Say "hi" & <go>', hidden: true, open: false, 'data-empty': undefined }, 'Tom & <Jerry>', 3, null, false),
			h('input', { id: 'b', spellcheck: false, required: true, 'aria-busy': true }),
			h(Label, { text: 'x > y' }),
			h('label', { htmlFor: 'b', className: 'field' }, h('textarea', { readOnly: true, tabIndex: 0, rows: 2 })),
		),
	)
	expect(markup).toBe('<p id="a" title="Say &quot;hi&quot; &amp; &lt;go&gt;" hidden>Tom &amp; &lt;Jerry&gt;3</p><input id="b" spellcheck="false" required aria-busy="true" /><span class="label">x &gt; y</span><label for="b" class="field"><textarea readonly tabindex="0" rows="2"></textarea></label>')
})

test('inserts repository-owned raw markup verbatim and rejects unsupported nodes', () => {
	expect(renderStaticMarkup(h('div', null, h(RawMarkup, { html: '<b>kept</b>' })))).toBe('<div><b>kept</b></div>')
	class Legacy extends Component {
		override render() {
			return h('p', null)
		}
	}
	expect(() => renderStaticMarkup(h(Legacy, null))).toThrow('Static markup does not render class components')
	expect(() => renderStaticMarkup(h('p', { onClick: () => undefined }))).toThrow('Static markup attribute onClick must be a string, number, or boolean')
})

import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { ariaIdReferenceFailures } from './check-html-structure.mts'

const ariaIdReferenceAttributes = [
	{ allowsMultiple: false, name: 'aria-activedescendant' },
	{ allowsMultiple: true, name: 'aria-controls' },
	{ allowsMultiple: true, name: 'aria-describedby' },
	{ allowsMultiple: false, name: 'aria-details' },
	{ allowsMultiple: false, name: 'aria-errormessage' },
	{ allowsMultiple: true, name: 'aria-flowto' },
	{ allowsMultiple: true, name: 'aria-labelledby' },
	{ allowsMultiple: true, name: 'aria-owns' },
] as const

function parseHtml(html: string) {
	const window = new Window()
	window.document.write(html)
	window.document.close()
	return window
}

describe('HTML ARIA ID reference validation', () => {
	for (const attribute of ariaIdReferenceAttributes) {
		test(`${attribute.name} rejects missing targets`, () => {
			const window = parseHtml(`<button ${attribute.name}="missing-target">Action</button>`)
			expect(ariaIdReferenceFailures(window.document)).toEqual([`<button> ${attribute.name} references missing id "missing-target"`])
			window.close()
		})

		test(`${attribute.name} accepts existing targets`, () => {
			const referencedIds = attribute.allowsMultiple ? 'first-target second-target' : 'first-target'
			const window = parseHtml(`<button ${attribute.name}="${referencedIds}">Action</button><div id="first-target"></div><div id="second-target"></div>`)
			expect(ariaIdReferenceFailures(window.document)).toEqual([])
			window.close()
		})

		if (!attribute.allowsMultiple) {
			test(`${attribute.name} rejects multiple existing targets`, () => {
				const window = parseHtml(`<button ${attribute.name}="first-target second-target">Action</button><div id="first-target"></div><div id="second-target"></div>`)
				expect(ariaIdReferenceFailures(window.document)).toEqual([`<button> ${attribute.name} must reference exactly one id`])
				window.close()
			})
		}
	}
})

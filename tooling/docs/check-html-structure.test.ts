import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Window } from 'happy-dom'
import { ariaIdReferenceFailures, validateHtmlStructure } from './check-html-structure.mts'

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

test('accepts the built-in top fragment and rejects unknown fragments (#1424)', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'zoltar-html-links-'))
	try {
		const filePath = path.join(directory, 'index.html')
		await writeFile(filePath, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Links</title></head><body><a href="#top">Top</a><a href="#missing">Missing</a></body></html>')
		const failures = await validateHtmlStructure([filePath])
		expect(failures.map(failure => failure.message)).toEqual(['<a> links to missing anchor "#missing"'])
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

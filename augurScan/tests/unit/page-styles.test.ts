import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const styles = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8')
const buildScript = await readFile(new URL('../../scripts/build-browser.ts', import.meta.url), 'utf8')

test('the hidden attribute outranks component display rules', () => {
	expect(styles).toMatch(/^\[hidden\] \{\n\tdisplay: none !important;\n\}/mu)
	expect(styles).not.toMatch(/\[hidden\]\) \{|[^\n]\[hidden\] \{/u)
})

test("Plot's base rules are served from the stylesheet because the CSP blocks its inline style element", async () => {
	const plotStyleSource = await readFile(path.join(path.dirname(Bun.resolveSync('@observablehq/plot', import.meta.dir)), 'style.js'), 'utf8')
	const defaultClassName = /if \(name === undefined\) return "([\w-]+)"/u.exec(plotStyleSource)?.[1]
	if (defaultClassName === undefined) throw new Error('Could not find the default Plot class name')
	expect(styles).toContain(`:where(.${defaultClassName}) {\n\t--plot-background: var(--panel);\n\tdisplay: block;\n\theight: auto;\n\tmax-width: 100%;\n}`)
	expect(styles).toContain(`:where(.${defaultClassName}-swatches-wrap) {`)
})

test('search results overlay the page instead of resizing the header', () => {
	expect(styles).toMatch(/\.global-search-results \{\n\tposition: absolute;\n\tz-index: 10;/u)
})

test('exact metric values wrap instead of being clipped', () => {
	const rule = /\.metric-card strong \{([^}]*)\}/u.exec(styles)?.[1]
	if (rule === undefined) throw new Error('Missing metric value rule')
	expect(rule).toContain('overflow-wrap: anywhere')
	expect(rule).not.toContain('text-overflow')
})

test('activity rows are at least as wide as their column tracks', () => {
	expect(styles).toMatch(/\.feed-header,\n\.log-row \{[^}]*min-width: 1100px;[^}]*grid-template-columns: 112px 200px minmax\(140px, 1fr\) minmax\(160px, 1fr\) minmax\(140px, 1fr\) 130px 120px;/u)
	expect(styles.match(/grid-template-columns: 1\d\dpx \d+px/gu)?.length).toBe(1)
})

test('printing swaps the dark theme for dark text on white', () => {
	expect(styles).toMatch(/@media print \{\n\t:root \{[^}]*--text: #111820;/u)
})

test('the production bundle is minified', () => {
	expect(buildScript).toContain('minify: true')
})

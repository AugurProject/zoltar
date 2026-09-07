import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const cssRoot = 'ui/coreShared/css'

function readStylesheet(name: string) {
	return readFileSync(`${cssRoot}/${name}`, 'utf8')
}

test('core shared stylesheet partitions begin at cohesive ownership boundaries', () => {
	expect(readStylesheet('index.css')).toBe(
		['@import url("./base.css");', '@import url("./protocol-surfaces.css");', '@import url("./reporting-visualizations.css");', '@import url("./application-surfaces.css");', '@import url("./controls-and-responsive.css");', '@import url("./visual-foundation.css");', '@import url("./protocol-apps.css");', ''].join('\n'),
	)
	expect(readStylesheet('protocol-surfaces.css')).toStartWith('.entity-card {')
	expect(readStylesheet('reporting-visualizations.css')).toStartWith('.escalation-metrics {')
	expect(readStylesheet('application-surfaces.css')).toStartWith('.route-shell {')
	expect(readStylesheet('controls-and-responsive.css')).toStartWith('.view-tabs {')
	expect(readStylesheet('visual-foundation.css')).toStartWith('/* Shared visual behavior.')
	expect(readStylesheet('protocol-apps.css')).toStartWith('/* Zoltar and Statoblast remain separate operational products')
})

test('the visual foundation defines readable type, touch, geometry, and product accents', () => {
	const tokens = readStylesheet('tokens.css')
	for (const declaration of [
		'--accent-zoltar:',
		'--accent-statoblast:',
		'--accent-trading:',
		'--accent-augurscan:',
		'--outcome-yes:',
		'--outcome-no:',
		'--outcome-invalid:',
		'--font-label: 0.8125rem;',
		'--touch-target-min: 2.75rem;',
		'--radius-compact: 0.25rem;',
		'--radius-normal: 0.5rem;',
		'--radius-overlay: 0.75rem;',
	])
		expect(tokens).toContain(declaration)
})

test('persistent operational text and AugurScan disclosures keep accessible minimums', () => {
	const base = readStylesheet('base.css')
	const controls = readStylesheet('controls-and-responsive.css')
	const trading = readFileSync('ui/trading/css/app.css', 'utf8')
	const augurScan = readFileSync('augurScan/public/styles.css', 'utf8')

	expect(base).toMatch(/\.app-settings-menu label > span \{[^}]*font-size: var\(--font-label\);/s)
	expect(base).toMatch(/\.account-menu-network span \{[^}]*font-size: var\(--font-label\);/s)
	expect(controls).toMatch(/\.metric-inline-status \{[^}]*font-size: var\(--font-label\);/s)
	expect(trading).toMatch(/\.field \{[^}]*0\.8125rem ui-monospace/s)
	expect(trading).toMatch(/\.wallet-summary--loading \.wallet-summary__compact-loading \{[^}]*font-size: 0\.8125rem;/s)
	expect(trading).toMatch(/\.wallet-summary__detail-balances small \{[^}]*font-size: 0\.8125rem;/s)
	expect(trading).toMatch(/\.wallet-summary__detail-balances strong \{[^}]*0\.8125rem \/ 1\.25 ui-monospace/s)

	for (const selector of ['.operations-detail-header > a', '.operations-raw-evidence summary', '.operations-round-changes summary', '.chart-data-disclosure summary', '.detail-disclosure summary', '.rich-assets summary', '.account-transaction-action summary', '.explorer-link']) {
		expect(augurScan).toContain(selector)
	}
	expect(augurScan).toMatch(/\.explorer-link\s*\n\s*\) \{[^}]*min-height: var\(--control-height\);/s)
})

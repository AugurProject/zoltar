import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const cssRoot = 'ui/coreShared/css'
const featureStylesheets = { statoblast: 'ui/statoblastShared/css/index.css', zoltar: 'ui/zoltarShared/css/index.css', zoltarDeployment: 'ui/zoltarShared/css/deployment.css', zoltarQuestions: 'ui/zoltarShared/css/questions.css' } as const

function readStylesheet(name: string) {
	return readFileSync(`${cssRoot}/${name}`, 'utf8')
}

function readFeatureStylesheet(owner: keyof typeof featureStylesheets) {
	return readFileSync(featureStylesheets[owner], 'utf8')
}

function findSubminimumFontRules(stylesheet: string) {
	const violations: string[] = []
	for (const rule of stylesheet.matchAll(/(?<selector>[^{}]+)\{(?<body>[^{}]*)\}/g)) {
		const selector = rule.groups?.selector?.trim()
		const body = rule.groups?.body
		if (selector === undefined || body === undefined) throw new Error('Unable to inspect CSS rule')

		for (const declaration of body.matchAll(/(?<property>font(?:-size)?)\s*:\s*(?<value>[^;]+)/g)) {
			const property = declaration.groups?.property
			const value = declaration.groups?.value?.trim()
			if (property === undefined || value === undefined) throw new Error('Unable to inspect CSS font declaration')
			const absoluteSize = value.match(/(?<size>\d+(?:\.\d+)?)(?<unit>px|rem)(?:\s*\/|\s|$)/)
			const size = absoluteSize?.groups?.size
			const unit = absoluteSize?.groups?.unit
			if (size === undefined || unit === undefined) continue

			const pixels = Number(size) * (unit === 'rem' ? 16 : 1)
			const isDecorativeGlyph = selector.includes('::before') || selector.includes('::after') || selector.includes('.wallet-asset-action-icon')
			const isNonessentialEyebrow = pixels === 12 && (selector.includes('.eyebrow') || selector.includes('.section-kicker') || selector.includes('.brand small'))
			if (pixels < 13 && !isDecorativeGlyph && !isNonessentialEyebrow) violations.push(`${selector} { ${property}: ${value} }`)
		}
	}
	return violations
}

test('core shared stylesheet partitions begin at cohesive ownership boundaries', () => {
	expect(readStylesheet('index.css')).toBe(
		['@import url("./base.css");', '@import url("./simulation-banner.css");', '@import url("./protocol-surfaces.css");', '@import url("./application-surfaces.css");', '@import url("./controls-and-responsive.css");', '@import url("./visual-foundation.css");', '@import url("./protocol-apps.css");', ''].join('\n'),
	)
	expect(readStylesheet('simulation-banner.css')).toStartWith('/* Browser simulation banner.')
	expect(readStylesheet('protocol-surfaces.css')).toStartWith('.entity-card {')
	expect(readStylesheet('application-surfaces.css')).toStartWith('.route-shell {')
	expect(readStylesheet('controls-and-responsive.css')).toStartWith('.view-tabs {')
	expect(readStylesheet('visual-foundation.css')).toStartWith('/* Shared visual behavior.')
	expect(readStylesheet('protocol-apps.css')).toStartWith('/* Zoltar and Statoblast remain separate operational products')
})

test('feature stylesheets own their product rules and load after the shared sheet on the pages that render them', () => {
	const statoblast = readFeatureStylesheet('statoblast')
	const zoltar = readFeatureStylesheet('zoltar')
	const zoltarQuestions = readFeatureStylesheet('zoltarQuestions')
	const zoltarDeployment = readFeatureStylesheet('zoltarDeployment')
	expect(statoblast).toStartWith('/* Statoblast feature styles:')
	expect(zoltar).toStartWith('/* Zoltar feature styles:')
	expect(zoltarQuestions).toStartWith('/* Zoltar question styles:')
	expect(zoltarDeployment).toStartWith('/* Zoltar deployment route styles.')
	for (const selector of ['.truth-auction-panel', '.escalation-sides', '.security-pool-strip', '.vault-workspace', '.liquidation-modal-actions', '.oracle-actions', '.fork-workflow-stage']) expect(statoblast).toContain(`${selector} {`)
	for (const selector of ['.question-create-editor', '.question-preview', '.question-draft-preview']) expect(zoltarQuestions).toContain(`${selector} {`)
	expect(zoltarDeployment).toContain('.deployment-contract-details {')
	expect(zoltar).toContain('.categorical-outcomes {')
	// Statoblast and Trading load only the Zoltar partials they render, so the Zoltar-only sheet must not carry rules they need.
	for (const selector of ['.question-', '.deployment-']) expect(zoltar).not.toContain(`\n${selector}`)
	const shared = ['base.css', 'simulation-banner.css', 'protocol-surfaces.css', 'application-surfaces.css', 'controls-and-responsive.css', 'visual-foundation.css', 'protocol-apps.css'].map(readStylesheet).join('\n')
	for (const selector of ['.truth-auction-', '.escalation-side', '.security-pool-strip', '.vault-workspace', '.question-draft-preview', '.deployment-contract-details']) expect(shared).not.toContain(`\n${selector}`)
	// Narrow-viewport overrides for feature grids must follow their base rules, so they live in the owning sheet rather than the earlier-loaded shared sheet.
	for (const selector of ['.security-pool-strip-stats', '.vault-preview-side-metrics', '.vault-detail-hero', '.trading-share-callouts', '.escalation-metrics', '.fork-summary-grid', '.categorical-outcome-row', '.question-preview-meta', '.question-draft-preview-meta'])
		expect(shared).not.toMatch(new RegExp(`\\n\\t?${selector.replaceAll('.', '\\.')}[,\\s{]`))
	for (const selector of ['.escalation-metrics', '.security-pool-strip-stats', '.vault-detail-hero']) expect(statoblast.lastIndexOf(`\t${selector},`)).toBeGreaterThan(statoblast.indexOf(`${selector} {`))
	expect(zoltar.lastIndexOf('\t.categorical-outcome-row')).toBeGreaterThan(zoltar.indexOf('.categorical-outcome-row {'))
	expect(zoltarQuestions.lastIndexOf('\t.question-preview-meta')).toBeGreaterThan(zoltarQuestions.indexOf('.question-preview-meta {'))
	expect(readStylesheet('simulation-banner.css')).toContain('.simulation-banner {')
	expect(shared.split('\n.simulation-banner {')).toHaveLength(2)

	const sharedLink = '<link rel="stylesheet" href="/ui/coreShared/css/index.css" />'
	const zoltarQuestionsLink = '<link rel="stylesheet" href="/ui/zoltarShared/css/questions.css" />'
	const zoltarDeploymentLink = '<link rel="stylesheet" href="/ui/zoltarShared/css/deployment.css" />'
	const zoltarLink = '<link rel="stylesheet" href="/ui/zoltarShared/css/index.css" />'
	const statoblastLink = '<link rel="stylesheet" href="/ui/statoblastShared/css/index.css" />'
	const zoltarPage = readFileSync('ui/zoltar/index.html', 'utf8')
	const statoblastPage = readFileSync('ui/statoblast/index.html', 'utf8')
	const tradingPage = readFileSync('ui/trading/index.html', 'utf8')
	const expectLinkOrder = (page: string, links: readonly string[]) => {
		const offsets = links.map(link => page.indexOf(link))
		expect(offsets.every(offset => offset >= 0)).toBe(true)
		expect([...offsets].sort((left, right) => left - right)).toEqual(offsets)
	}
	expectLinkOrder(zoltarPage, [sharedLink, zoltarQuestionsLink, zoltarDeploymentLink, zoltarLink])
	expect(zoltarPage).not.toContain(statoblastLink)
	// Statoblast renders Zoltar question previews, the question create form, and the deployment route, but none of the Zoltar-only rules.
	expectLinkOrder(statoblastPage, [sharedLink, zoltarQuestionsLink, zoltarDeploymentLink, statoblastLink])
	expect(statoblastPage).not.toContain(zoltarLink)
	// Trading renders the shared fork question preview on its universe route, so it loads only the question sheet after the shared sheet.
	expectLinkOrder(tradingPage, [sharedLink, zoltarQuestionsLink])
	expect(tradingPage).not.toContain(zoltarDeploymentLink)
	expect(tradingPage).not.toContain(zoltarLink)
	expect(tradingPage).not.toContain(statoblastLink)
})

test('the vendored mono face is declared once and leads the mono stack', () => {
	const foundation = readStylesheet('visual-foundation.css')
	expect(foundation.match(/@font-face \{/g)).toHaveLength(2)
	expect(foundation).toMatch(/@font-face \{[^}]*font-weight: 400;[^}]*font-display: swap;[^}]*url\("\.\.\/vendor\/fonts\/ibm-plex-mono-latin-400-normal\.woff2"\)/s)
	expect(foundation).toMatch(/@font-face \{[^}]*font-weight: 600;[^}]*font-display: swap;[^}]*url\("\.\.\/vendor\/fonts\/ibm-plex-mono-latin-600-normal\.woff2"\)/s)
	expect(readStylesheet('tokens.css')).toContain('--font-family-mono: "IBM Plex Mono", ui-monospace,')
})

test('the visual foundation defines readable type, touch, geometry, and product accents', () => {
	const tokens = readStylesheet('tokens.css')
	for (const declaration of ['--accent-zoltar:', '--accent-statoblast:', '--accent-trading:', '--outcome-yes:', '--outcome-no:', '--outcome-invalid:', '--font-label: 0.8125rem;', '--touch-target-min: 2.75rem;', '--radius-compact: 0.25rem;', '--radius-normal: 0.5rem;', '--radius-overlay: 0.75rem;'])
		expect(tokens).toContain(declaration)
})

test('persistent operational text and AugurScan disclosures keep accessible minimums', () => {
	const base = readStylesheet('base.css')
	const controls = readStylesheet('controls-and-responsive.css')
	const augurScan = readFileSync('augurScan/public/styles.css', 'utf8')

	expect(base).toMatch(/\.app-settings-menu label > span \{[^}]*font-size: var\(--font-label\);/s)
	expect(base).toMatch(/\.account-menu-network span \{[^}]*font-size: var\(--font-label\);/s)
	expect(controls).toMatch(/\.metric-inline-status \{[^}]*font-size: var\(--font-label\);/s)
	expect(controls).toMatch(/@media \(max-width: 56rem\) \{[^}]*\.header-toolbar \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/s)
	expect(controls).toMatch(/\.header-toolbar-controls \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;[^}]*justify-content: flex-start;/s)
	expect(base).toMatch(/\.loading-value \{[^}]*font: inherit;/s)
	expect(base).toMatch(/\.metric-label,\s*\.workflow-section-label \{[^}]*font-size: var\(--font-label\);/s)
	expect(base).toMatch(/\.overview-inline-metrics strong \{[^}]*font-size: var\(--font-value\);/s)
	expect(readStylesheet('visual-foundation.css')).toMatch(/button,\s*\[role="button"\][^{]*\{[^}]*min-height: var\(--touch-target-min\);/s)
	expect(controls).toMatch(/\.view-tab \{[^}]*min-height: var\(--touch-target-min\);/s)
	expect(base).toMatch(/\.metric-label-refresh \{[^}]*font-size: var\(--font-label\);/s)
	expect(base).toMatch(/\.address-value\.copyable \{[^}]*min-height: var\(--touch-target-min\);/s)
	expect(base).toMatch(/\.identifier-value\.copyable \{[^}]*min-height: var\(--touch-target-min\);/s)
	expect(readStylesheet('protocol-surfaces.css')).toMatch(/\.global-transaction-notice-detail \{[^}]*font-size: var\(--font-label\);/s)
	expect(augurScan).toMatch(/\.feed-state \{[^}]*font-size: 0\.8125rem;/s)
	expect(augurScan).toMatch(/\.product-nav a \{[^}]*min-height: var\(--control-height\);/s)
	expect(augurScan).toMatch(/\.block-number \{[^}]*min-height: var\(--control-height\);/s)

	for (const selector of ['.operations-detail-header > a', '.operations-raw-evidence summary', '.operations-round-changes summary', '.chart-data-disclosure summary', '.detail-disclosure summary', '.rich-assets summary', '.account-transaction-action summary', '.explorer-link']) {
		expect(augurScan).toContain(selector)
	}
	expect(augurScan).toMatch(/\.explorer-link\s*\) \{[^}]*min-height: var\(--control-height\);/s)
})

test('production styles reserve sub-13px type for nonessential eyebrows and decorative glyphs', () => {
	for (const stylesheet of [
		readStylesheet('base.css'),
		readStylesheet('simulation-banner.css'),
		readStylesheet('protocol-surfaces.css'),
		readFeatureStylesheet('statoblast'),
		readFeatureStylesheet('zoltar'),
		readFeatureStylesheet('zoltarQuestions'),
		readFeatureStylesheet('zoltarDeployment'),
		readFileSync('ui/trading/css/app.css', 'utf8'),
		readFileSync('augurScan/public/styles.css', 'utf8'),
	]) {
		expect(findSubminimumFontRules(stylesheet)).toEqual([])
	}
})

test('product accent hues are only defined in tokens so Statoblast never inherits Zoltar cyan', () => {
	const productHueLiteral = /rgba?\(\s*(?:56,\s*213,\s*255|124,\s*108,\s*255|160,\s*124,\s*255|183,\s*238,\s*81|85,\s*200,\s*228|42,\s*181,\s*216|22,\s*148,\s*184|19,\s*127,\s*159)\b|#(?:38d5ff|7c6cff|a07cff|b7ee51|55c8e4|2ab5d8|1694b8|137f9f)\b/i
	for (const name of [
		'base.css',
		'simulation-banner.css',
		'protocol-surfaces.css',
		'application-surfaces.css',
		'controls-and-responsive.css',
		'visual-foundation.css',
		'protocol-apps.css',
		featureStylesheets.statoblast,
		featureStylesheets.zoltar,
		featureStylesheets.zoltarQuestions,
		featureStylesheets.zoltarDeployment,
	]) {
		const offendingLines = (name.includes('/') ? readFileSync(name, 'utf8') : readStylesheet(name)).split('\n').filter(line => productHueLiteral.test(line))
		expect({ name, offendingLines }).toEqual({ name, offendingLines: [] })
	}
	const tokens = readStylesheet('tokens.css')
	for (const derivedToken of [
		'--accent-faint',
		'--accent-soft',
		'--accent-medium',
		'--accent-emphasis-soft',
		'--interactive-border',
		'--interactive-border-hover',
		'--interactive-bg-hover',
		'--focus',
		'--border-active',
		'--primary-button-bg',
		'--primary-button-bg-hover',
		'--primary-button-border',
		'--primary-button-border-hover',
	]) {
		expect(tokens).toMatch(new RegExp(`${derivedToken}: (?:color-mix\\(in srgb, )?var\\(--accent(?:-strong)?\\)`))
	}
	expect(tokens).toContain('--primary-button-text: var(--bg-deep);')
	const tokenLinesWithProductHues = tokens.split('\n').filter(line => productHueLiteral.test(line))
	expect(tokenLinesWithProductHues).toEqual(['\t--accent-zoltar: rgba(56, 213, 255, 1);', '\t--accent-statoblast: rgba(160, 124, 255, 1);', '\t--accent-trading: rgba(183, 238, 81, 1);', '\t--accent-strong: rgba(124, 108, 255, 1);'])
	expect(readStylesheet('base.css')).toMatch(/button\.primary \{[^}]*color: var\(--primary-button-text\);/s)
})

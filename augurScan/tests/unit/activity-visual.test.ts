import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { Window } from 'happy-dom'
import { renderActivityRow } from '../../browser/activity-row.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

const activityRouteSource = await readFile(new URL('../../browser/activity-route.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../../public/styles.css', import.meta.url), 'utf8')

const cssRule = (selector: string) => {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'u').exec(styles)
	if (match?.[1] === undefined) throw new Error(`Missing CSS rule for ${selector}`)
	return match[1]
}

test('activity row fields use full-height compact targets', () => {
	const targetRule = cssRule('.activity-target')
	expect(targetRule).toContain('min-height: var(--control-height)')
	expect(targetRule).toContain('display: flex')
	expect(targetRule).toContain('overflow: hidden')
})

test('filtered empty activity keeps only its specific no-match status', () => {
	expect(activityRouteSource).toContain("feedState.textContent = 'No project logs match these filters yet.'")
	expect(activityRouteSource).toContain("$('#activity-summary').textContent = visibleCount === 0 ? ''")
	expect(activityRouteSource).not.toContain("visibleCount === 0 ? 'No logs shown'")
})

test('activity detail and narrow navigation controls retain full touch targets', () => {
	for (const selector of ['.detail-disclosure summary', '.icon-button']) expect(cssRule(selector)).toContain('var(--control-height)')

	expect(styles).toMatch(/@media \(max-width: 600px\) \{[\s\S]*?\.product-nav \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);[^}]*overflow-x: visible;/u)
	expect(styles).toMatch(/@media \(max-width: 600px\) \{[\s\S]*?\.product-nav a \{[^}]*min-width: 0;[^}]*padding-inline: 0\.2rem;/u)
})

test('activity rows switch to labelled two-line rows instead of scrolling sideways below the table width', () => {
	expect(cssRule('.feed-shell')).toContain('container: activity-feed / inline-size')
	const intermediate = /@container activity-feed \(max-width: 1181px\) \{([\s\S]*?)\n\}/u.exec(styles)?.[1]
	if (intermediate === undefined) throw new Error('Missing intermediate activity layout')
	expect(intermediate).toMatch(/\.feed-header \{[^}]*display: none;/u)
	expect(intermediate).toMatch(/\.log-row \{[^}]*min-width: 0;[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/u)
	expect(intermediate).toMatch(/\.activity-field-label \{[^}]*position: static;/u)
	// The intermediate rules precede the phone layout so the phone's card rules win where both apply.
	const phoneFeedLayout = styles.search(/\n\t\.feed-shell \{\n\t\toverflow: visible;/u)
	expect(phoneFeedLayout).toBeGreaterThan(-1)
	expect(styles.indexOf('@container activity-feed')).toBeLessThan(phoneFeedLayout)
	expect(styles).not.toMatch(/\.log-row > [^{]*::before \{[^}]*content: "/u)
})

test('every activity cell names its field for screen readers and narrow layouts', async () => {
	const browser = new Window({ url: 'https://scanner.test/' })
	const restoreGlobals = overrideGlobals({ document: browser.document, window: browser })
	try {
		const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
			const node = document.createElement(tag)
			node.className = className
			if (text !== undefined) node.textContent = text
			return node
		}
		const row = renderActivityRow(
			{
				setLiveRecord: node => node,
				element,
				number: String,
				isDemo: false,
				time: () => '2026-01-01 00:00:00 UTC',
				age: () => '1m ago',
				exactTimestamp: () => '2026-01-01T00:00:00.000Z',
				eventDrawerFor: () => undefined,
				closeEventDrawer: () => undefined,
				openDetail: async () => true,
			},
			{
				chain_id: '1',
				network_id: 'mainnet',
				block_number: '10',
				block_hash: `0x${'1'.repeat(64)}`,
				block_timestamp: '2026-01-01T00:00:00Z',
				transaction_index: 0,
				log_index: 2,
				tx_hash: `0x${'2'.repeat(64)}`,
				emitter_address: `0x${'3'.repeat(40)}`,
				contract_label: 'OpenOracle',
				contract_kind: null,
				event_name: 'ReportSubmitted',
				summary: 'Report 7',
				decode_status: 'decoded',
				canonical: true,
				finalized: true,
				topics: [],
				data: '0x',
				arguments: null,
				display_arguments: null,
				argument_schema: null,
				origin_address: `0x${'4'.repeat(40)}`,
				explorer_base_url: 'https://etherscan.io',
				function_name: 'submitReport',
			},
		)
		const labels = [...row.children].filter(cell => cell.classList.contains('cell')).map(cell => cell.querySelector(':scope > .activity-field-label')?.textContent)
		expect(labels).toEqual(['Block', 'Time', 'Contract', 'Event', 'Function', 'Transaction', 'Origin'])
		for (const label of row.querySelectorAll('.activity-field-label')) expect(label.classList.contains('sr-only')).toBe(true)
		expect(row.querySelector('.cell-time .activity-time-value')?.textContent).toBe('2026-01-01 00:00:00 UTC')
	} finally {
		restoreGlobals()
		await browser.happyDOM.close()
	}
})

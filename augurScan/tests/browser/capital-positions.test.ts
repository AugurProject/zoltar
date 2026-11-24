import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports } from './browser-test.ts'

const ledger = `0x${'5'.repeat(40)}`
const owner = '0x00000000000000000000000002468acf13579bde'
const panel = (title: string) => `[...document.querySelectorAll('#operations-content .operations-panel')].find(panel => panel.querySelector('h3')?.textContent === ${JSON.stringify(title)})`
const noOverflow = `document.documentElement.scrollWidth <= document.documentElement.clientWidth`

for (const viewport of qaViewports) {
	const size = `${viewport.width}x${viewport.height}`
	browserTest(
		`risk status ranks capital positions and attributes the liquidation feed to owners at ${size}`,
		async () => {
			await withBrowserPage(`${origin}/operations/risk?demo=1&chainId=1`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`${panel('Capital positions')} !== undefined`)
				// Most at risk first: the position open to take-over precedes the healthy and the uncommitted ones.
				expect(await evaluate(`[...${panel('Capital positions')}.querySelectorAll('.operations-row strong')].map(node => node.textContent)`)).toEqual(['Take-over preconditions met', 'Healthy', 'No commitment'])
				const positions = await evaluate(`${panel('Capital positions')}.textContent`)
				expect(positions).toContain('3 positions · most at risk first')
				expect(positions).toContain('Critical · 12,350 REP principal · 50 USDC commitment · health 86.66%')
				expect(positions).toContain('Warning · health below the scanner threshold · 13,000 REP principal · 40 USDC commitment · health 114.03%')
				expect(positions).toContain('700 REP principal · 0 USDC commitment · no health factor')
				expect(await evaluate(`${panel('Capital ledgers')}.textContent`)).toContain('25,350 REP pledged · 90 USDC committed · 40 USDC healthy · 200 REP/USDC · price fresh · 3 owners')
				const feed = await evaluate(`${panel('Liquidation feed')}.textContent`)
				expect(feed).toContain('attributed to universe and owner, not to a question pool')
				expect(feed).toContain('position 7 (0x000000…579bde) → position 12 (0xcccccc…cccccc) · 40 USDC commitment · 300 REP award · universe 0')
				expect(feed).toContain('position 7 (0x000000…579bde) · 10 USDC commitment removed')
				expect(feed).toContain('report 1842 operation 0 · sponsor 0xcccccc…cccccc · succeeded')
				// A feed row opens the position it concerns.
				expect(await evaluate(`${panel('Liquidation feed')}.querySelector('a')?.getAttribute('href')`)).toBe(`/capital/${ledger}/${owner}?chainId=1&demo=1`)
				// A report operation opens its sponsor's address: a sponsor need not hold a position.
				expect(await evaluate(`[...${panel('Liquidation feed')}.querySelectorAll('a')].at(-1)?.getAttribute('href')`)).toBe(`/address/0x${'c'.repeat(40)}?chainId=1&demo=1`)
				expect(await evaluate(noOverflow)).toBe(true)
				// The first position links to its detail page, which keeps the canonical path.
				await evaluate(`${panel('Capital positions')}.querySelector('a.operations-row, .operations-row a').click()`)
				await waitFor(`location.pathname === '/capital/${ledger}/${owner}' && document.querySelector('#operations-content h2')?.textContent.startsWith('Capital position')`)
			})
		},
		30_000,
	)

	browserTest(
		`capital position detail shows current state, read history and attributed events at ${size}`,
		async () => {
			await withBrowserPage(`${origin}/capital/${ledger}/${owner}?demo=1&chainId=1`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`document.querySelector('#operations-content h2')?.textContent.replaceAll('\\u2060', '') === 'Capital position 0x000000…579bde'`)
				const cards = await evaluate(`Object.fromEntries([...document.querySelectorAll('#operations-content .operations-metrics > *')].map(card => [card.querySelector('span')?.textContent, card.querySelector('strong')?.textContent]))`)
				expect(cards).toMatchObject({ 'Protocol state': 'Take-over preconditions met', Principal: '12,350 REP', Commitment: '50 USDC', 'Health factor': '86.66%', Withdrawable: '0 REP', 'Unclaimed earnings': '1.5 USDC · 2 REP' })
				const risk = await evaluate(`${panel('Current risk state')}.textContent`)
				expect(risk).toContain('Critical · Pledged REP is below the requirement at the liquidation price')
				expect(risk).toContain('190 REP/USDC')
				// Fields shown as cards are not repeated, so no two rows share a label.
				const labels = (await evaluate(`[...${panel('Current risk state')}.querySelectorAll('.operations-row strong')].map(node => node.textContent)`)) as string[]
				expect(new Set(labels).size).toBe(labels.length)
				expect(labels).not.toContain('Principal')
				await evaluate(`document.querySelector('.entity-detail-tabs a[data-detail-tab="history"]').click()`)
				await waitFor(`${panel('Tagged position history')}?.hidden === false`)
				const history = await evaluate(`${panel('Tagged position history')}.textContent`)
				expect(history).toContain('12,650 REP principal · 100 USDC commitment · health 121.05%')
				expect(history).toContain('Failed position read')
				expect(history).toContain('execution reverted')
				const events = await evaluate(`${panel('Capital and liquidation events')}.textContent`)
				expect(events).toContain('Attributed to this owner and universe, not to a question pool')
				expect(events).toContain('Commitment take-over')
				// The page is scoped to one ledger, so its rows do not repeat the universe.
				expect(events).not.toContain('universe 0')
				expect(events).toContain('position 7 · 12,650 REP backing 100 USDC · target health 120%')
				expect(events).toContain('12,650 REP from 0x000000…579bde')
				// The report operation was sponsored by another owner and is not part of this history.
				expect(events).not.toContain('Report operation')
				expect(await evaluate(noOverflow)).toBe(true)
			})
		},
		30_000,
	)

	browserTest(
		`address profile and rich-list card list the owner's capital position at ${size}`,
		async () => {
			await withBrowserPage(`${origin}/address/${owner}?demo=1&chainId=1`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`document.querySelector('.address-profile-panel .rich-position') !== null`)
				const involvement = await evaluate(`[...document.querySelectorAll('.address-profile-panel')].find(section => section.querySelector('h3')?.textContent === 'Question ledgers and capital positions')?.textContent`)
				expect(involvement).toContain('Capital position · universe 0')
				expect(involvement).toContain('12,350 REP principal · 50 USDC commitment · health 86.66%')
				expect(await evaluate(`[...document.querySelectorAll('.state-stat')].find(card => card.querySelector('span')?.textContent === 'Capital positions')?.querySelector('strong')?.textContent`)).toBe('1')
				expect(await evaluate(`document.querySelector('.address-profile-panel .rich-position a[href*="/capital/"]')?.getAttribute('href')`)).toBe(`/capital/${ledger}/${owner}?chainId=1&demo=1`)
				expect(await evaluate(noOverflow)).toBe(true)
			})
			await withBrowserPage(`${origin}/addresses?demo=1&chainId=1&view=cards&expandRich=1`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`document.querySelector('#richlist-rows .rich-involvement') !== null`)
				const card = await evaluate(`document.querySelector('#richlist-rows article')?.textContent`)
				expect(card).toContain('1 capital position')
				expect(card).toContain('Capital position · universe 0')
				expect(await evaluate(`document.querySelector('#richlist-rows article a[href*="/capital/"]')?.getAttribute('href')`)).toBe(`/capital/${ledger}/${owner}?chainId=1&demo=1`)
				expect(card).toContain('12,350 REP principal · 50 USDC commitment · health 86.66%')
				expect(await evaluate(noOverflow)).toBe(true)
			})
		},
		30_000,
	)
}

browserTest(
	'the operations overview lists only capital positions that are at risk',
	async () => {
		await withBrowserPage(`${origin}/operations?demo=1&chainId=1`, { width: 1440, height: 900 }, async ({ evaluate, waitFor }) => {
			await waitFor(`${panel('Capital positions at risk')} !== undefined`)
			expect(await evaluate(`[...${panel('Capital positions at risk')}.querySelectorAll('.operations-row strong')].map(node => node.textContent)`)).toEqual(['Take-over preconditions met', 'Healthy'])
			// The healthy row is listed for its scanner warning; the uncommitted position is not at risk.
			expect(await evaluate(`${panel('Capital positions at risk')}.textContent`)).toContain('Warning · health below the scanner threshold · 13,000 REP principal')
		})
	},
	30_000,
)

for (const viewport of qaViewports)
	browserTest(
		`risk status and the overview show each universe's fee economics at ${viewport.width}x${viewport.height}`,
		async () => {
			await withBrowserPage(`${origin}/operations/risk?demo=1&chainId=1`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`${panel('Fee economics')} !== undefined`)
				const fees = await evaluate(`${panel('Fee economics')}.textContent`)
				expect(fees).toContain('2% annual holding fee · 0.3% base purchase fee · 700 USDC vesting to owners')
				expect(fees).toContain('1,250 USDC holding fees accrued · 960 USDC purchase charges, 900 USDC to owners · 1,100 USDC and 12 REP claimed · 25 USDC and 0 REP burned unassigned')
				const streams = await evaluate(`${panel('Question fee streams')}.textContent`)
				expect(streams).toContain('Active fee stream · ends 2030-01-01 00:00:00 UTC · universe 0')
				expect(streams).toContain('No fee stream')
				expect(streams).toContain('Ended 2024-01-01 00:00:00 UTC')
				expect(streams).not.toContain('per year')
				expect(streams).not.toContain('USDC')
				expect(streams).toContain('Latest 25 changes')
				expect(await evaluate(noOverflow)).toBe(true)
			})
			await withBrowserPage(`${origin}/operations?demo=1&chainId=1`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`${panel('Fee economics')} !== undefined`)
				expect(await evaluate(`${panel('Fee economics')}.textContent`)).toContain('1,250 USDC holding fees accrued')
				expect(await evaluate(noOverflow)).toBe(true)
			})
		},
		30_000,
	)

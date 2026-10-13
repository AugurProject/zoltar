import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { MarketOverview } from '../../features/MarketOverview.js'
import { MarketPosition } from '../../features/MarketPosition.js'
import { shareBalanceScope, type LiveMarket } from '../../protocol/live.js'
import { etherScaleMarketFixture } from '../support/liveMarketFixture.js'

const pool = `0x${'22'.repeat(20)}` as Address
const openMarket = etherScaleMarketFixture({ pool, title: 'Closed market fixture' })
const forkedMarket: LiveMarket = { ...openMarket, universeForkTime: 1n }
const SET = 10n ** 18n

describe('closed market presentation', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
	})

	test('leads an open market with its odds and labels a closed market odds as history', async () => {
		const open = await renderIntoDocument(<MarketOverview market={openMarket} nowSeconds={0n} position={null} />)
		expect(document.querySelectorAll('.market-overview > .probability')).toHaveLength(1)
		expect(document.querySelector('.market-odds-closed')).toBeNull()
		await open.cleanup()

		const closed = await renderIntoDocument(<MarketOverview market={forkedMarket} nowSeconds={0n} position={null} />)
		cleanupRendered = closed.cleanup
		expect(document.querySelectorAll('.market-overview .probability')).toHaveLength(1)
		expect(document.querySelector('.market-overview > .probability')).toBeNull()
		expect(document.querySelector('.market-odds-closed .metric-label')?.textContent).toBe('Last odds before trading closed')
		expect(document.querySelector('.market-odds-closed .probability')).not.toBeNull()
	})

	test('says once, above the holdings, that a forked market cannot redeem its shares', async () => {
		const rendered = await renderIntoDocument(
			<MarketPosition
				market={forkedMarket}
				holdings={{ balances: { scope: shareBalanceScope(forkedMarket), yes: SET, no: SET, invalid: SET, lp: 0n }, balanceState: 'ready', balanceError: undefined, retry: async () => undefined }}
				wallet={{ networkMismatchReason: undefined }}
				disabled={false}
				ownsBalanceError={false}
			/>,
		)
		cleanupRendered = rendered.cleanup
		expect(document.querySelector('.market-holdings')?.textContent).not.toContain('Redemption unavailable')
		// The note heads the whole position, before the holdings list, so it never reads as one holding's caption.
		const notes = Array.from(document.querySelectorAll('.market-position .market-position-note'))
		expect(notes.map(note => note.textContent)).toEqual(['Share redemption unavailable'])
		expect(notes[0]?.nextElementSibling?.classList.contains('market-holdings')).toBe(true)
	})

	test('says nothing about redemption to a wallet that holds no shares', async () => {
		const rendered = await renderIntoDocument(
			<MarketPosition market={forkedMarket} holdings={{ balances: { scope: shareBalanceScope(forkedMarket), yes: 0n, no: 0n, invalid: 0n, lp: 0n }, balanceState: 'ready', balanceError: undefined, retry: async () => undefined }} wallet={{ networkMismatchReason: undefined }} disabled={false} ownsBalanceError={false} />,
		)
		cleanupRendered = rendered.cleanup
		expect(document.querySelector('.market-position .market-position-note')).toBeNull()
	})
})

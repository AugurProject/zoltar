import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LivePortfolio } from '../../features/LivePortfolio.js'
import type { LiveMarket } from '../../protocol/live.js'

const SET = 10n ** 36n
const NOW = 1_000_000n
const openPool: Address = `0x${'12'.repeat(20)}`
const resolvedPool: Address = `0x${'56'.repeat(20)}`
const shareToken: Address = `0x${'34'.repeat(20)}`

const openMarket: LiveMarket = {
	pool: openPool,
	pair: `0x${'9a'.repeat(20)}`,
	shareToken,
	universeId: 7n,
	questionId: 9n,
	title: 'Open market',
	description: 'Overview fixture',
	endTime: NOW + 2n * 24n * 60n * 60n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 1n,
	systemState: 0,
	awaitingForkContinuation: false,
	universeForkTime: 0n,
	vaultCount: 1n,
	shareTokenSupplyAttoShares: 100n * SET,
	settlementCollateralAttoEth: 100n * 10n ** 18n,
	currentRetentionRate: 10n ** 18n,
	totalCapacityOwnershipAttoRep: 1n,
	feeEligibleCapacityOwnershipAttoRep: 1n,
	mintingCapacityCeilingAttoEth: 1n,
	availableMintingCapacityAttoEth: 1n,
	feeBps: 30n,
	tradingStatus: undefined,
	questionOutcome: 3,
	yesReserve: 10n * SET,
	noReserve: 10n * SET,
	lpTotalSupply: 10n * SET,
}
const resolvedMarket: LiveMarket = { ...openMarket, pool: resolvedPool, title: 'Resolved market', questionOutcome: 1 }

function scope(pool: Address) {
	return { pool, shareToken, invalidTokenId: 1_792n, yesTokenId: 1_793n, noTokenId: 1_794n }
}

describe('portfolio overview', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: 'http://localhost/#/portfolio',
	})

	test('summarizes total value and attention items and offers Sell or Redeem per row', async () => {
		const rendered = await renderIntoDocument(
			<LivePortfolio
				entries={[
					{ market: openMarket, balances: { scope: scope(openPool), yes: SET, no: SET, invalid: SET, lp: 0n }, error: undefined },
					{ market: resolvedMarket, balances: { scope: scope(resolvedPool), yes: 2n * SET, no: 0n, invalid: 0n, lp: 0n }, error: undefined },
				]}
				balanceState='ready'
				balanceError={undefined}
				retryBalances={async () => undefined}
				nowSeconds={NOW}
			/>,
		)
		cleanupRendered = rendered.cleanup
		const summary = rendered.container.querySelector('[aria-label="Portfolio summary"]')
		expect(summary?.textContent).toContain('Total value3 ETH')
		expect(summary?.textContent).toContain('Profit / lossNot available')
		expect(summary?.textContent).toContain('Positions2')
		expect(summary?.textContent).toContain('Action items2')
		const items = Array.from(rendered.container.querySelectorAll('.portfolio-action-items li')).map(item => item.textContent)
		expect(items).toHaveLength(2)
		expect(items[0]).toContain('Trading closes')
		expect(items[0]).toContain('Open market')
		expect(items[1]).toContain('Resolved market')
		expect(items[1]).toContain('No deadline')
		// The badge names the state; the link carries the verb.
		expect(rendered.container.querySelector('.portfolio-action-items li:nth-child(2) .badge')?.textContent).toBe('Payout ready')
		expect(rendered.container.querySelector('.portfolio-action-items li:nth-child(2) a')?.textContent).toBe('Redeem')
		expect(rendered.container.querySelector(`[data-portfolio-pool="${openPool}"] a[aria-label="Sell: Open market"]`)?.getAttribute('href')).toBe(`#/market/${openPool}`)
		expect(rendered.container.querySelector(`[data-portfolio-pool="${openPool}"] a[aria-label^="Redeem"]`)).toBeNull()
		expect(rendered.container.querySelector(`[data-portfolio-pool="${resolvedPool}"] a[aria-label="Redeem: Resolved market"]`)?.getAttribute('href')).toBe(`#/market/${resolvedPool}`)
		expect(rendered.container.querySelector(`[data-portfolio-pool="${resolvedPool}"] a[aria-label^="Sell"]`)).toBeNull()
		expect(rendered.container.querySelector(`[data-portfolio-pool="${resolvedPool}"]`)?.textContent).toContain('Value now2 ETH')
	})

	test('says when shares are left out of the total until resolution', async () => {
		const rendered = await renderIntoDocument(<LivePortfolio entries={[{ market: openMarket, balances: { scope: scope(openPool), yes: 0n, no: 0n, invalid: 0n, lp: SET }, error: undefined }]} balanceState='ready' balanceError={undefined} retryBalances={async () => undefined} nowSeconds={NOW} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[aria-label="Portfolio summary"]')?.textContent).toContain('Excludes shares that pay at resolution')
		expect(rendered.container.querySelector(`[data-portfolio-pool="${openPool}"]`)?.textContent).toContain('other shares pay at resolution')
		// A liquidity provider cannot sell; trading closing soon points at withdrawal instead.
		expect(rendered.container.querySelector(`[data-portfolio-pool="${openPool}"] a[aria-label^="Sell"]`)).toBeNull()
		expect(rendered.container.querySelector('.portfolio-action-items a')?.getAttribute('href')).toBe(`#/liquidity/${openPool}`)
	})

	test('lists every reason the total leaves value out', async () => {
		const forkedMarket: LiveMarket = { ...openMarket, pool: resolvedPool, title: 'Forked market', universeForkTime: 1n, systemState: 1 }
		const rendered = await renderIntoDocument(
			<LivePortfolio
				entries={[
					{ market: forkedMarket, balances: { scope: scope(resolvedPool), yes: SET, no: 0n, invalid: SET, lp: 0n }, error: undefined },
					{ market: openMarket, balances: { scope: scope(openPool), yes: 0n, no: 0n, invalid: 0n, lp: SET }, error: undefined },
				]}
				balanceState='ready'
				balanceError={undefined}
				retryBalances={async () => undefined}
				nowSeconds={NOW}
			/>,
		)
		cleanupRendered = rendered.cleanup
		const summary = rendered.container.querySelector('[aria-label="Portfolio summary"]')?.textContent
		expect(summary).toContain('Excludes 1 position without a price')
		expect(summary).toContain('Excludes shares that pay at resolution')
	})

	test('offers the wallet action inline while disconnected and hides the summary', async () => {
		let connects = 0
		const rendered = await renderIntoDocument(<LivePortfolio entries={[]} balanceState='disconnected' balanceError={undefined} retryBalances={async () => undefined} nowSeconds={NOW} walletAction={{ label: 'Connect wallet', disabled: false, onClick: () => (connects += 1) }} />)
		cleanupRendered = rendered.cleanup
		const button = rendered.container.querySelector('.empty-state button')
		expect(button?.textContent).toBe('Connect wallet')
		if (!(button instanceof HTMLButtonElement)) throw new Error('Connect button missing')
		button.click()
		expect(connects).toBe(1)
		expect(rendered.container.querySelector('[aria-label="Portfolio summary"]')).toBeNull()
	})
})

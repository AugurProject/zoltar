import { getTransactionButtonState } from '@zoltar/ui-core-shared/tests/testUtils/transactionActionButton.js'
import { OutcomeHolding } from '../../features/OutcomeHolding.js'
import { MarketPosition } from '../../features/MarketPosition.js'
import { BackingDetails } from '../../features/BackingDetails.js'
import { TradeEstimatePanel } from '../../features/TradeEstimatePanel.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { liveMarketFixture, ticketEstimateFor } from '../support/liveMarketFixture.js'
import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { LiveSecurityPoolDetails, PairInitializationAction, SecurityPoolRouteEmptyState } from '../../features/LiveSecurityPoolDetails.js'
import { LivePortfolio } from '../../features/LivePortfolio.js'
import { shareBalanceScope, type LiveMarket } from '../../protocol/live.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

const pool: Address = `0x${'12'.repeat(20)}`
const shareToken: Address = `0x${'34'.repeat(20)}`
const secondPool: Address = `0x${'56'.repeat(20)}`
const secondShareToken: Address = `0x${'78'.repeat(20)}`

const market = liveMarketFixture({
	pool,
	pair: undefined,
	shareToken,
	universeId: 7n,
	questionId: 9n,
	title: 'Scoped portfolio',
	description: 'Scope fixture',
	initialReportPriorityFeeAttoEthPerGas: 1n,
	shareTokenSupplyAttoShares: 100n * 10n ** 18n,
	settlementCollateralAttoEth: 100n * 10n ** 18n,
	yesReserve: 0n,
	noReserve: 0n,
	lpTotalSupply: 0n,
})

describe('live portfolio scope', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: 'http://localhost/#/portfolio',
	})

	test('describes a disabled portfolio wallet action', async () => {
		const rendered = await renderIntoDocument(<LivePortfolio entries={[]} balanceState='disconnected' balanceError={undefined} retryBalances={async () => undefined} nowSeconds={0n} walletAction={{ label: 'Connect wallet', disabled: true, onClick: () => undefined }} />)
		cleanupRendered = rendered.cleanup
		expect(getTransactionButtonState(rendered.container, 'Connect wallet').reason).toBeTruthy()
	})

	test('describes why pair initialization is unavailable', async () => {
		const rendered = await renderIntoDocument(<PairInitializationAction market={{ ...market, endTime: 1n }} nowSeconds={2n} />)
		cleanupRendered = rendered.cleanup
		const button = rendered.container.querySelector('button:not([aria-label^="Copy"]):not(.favorite-toggle)')
		expect(button?.getAttribute('aria-describedby')).toBeTruthy()
	})

	for (const state of ['disconnected', 'loading', 'error'] as const) {
		test(`links to pool details without exposing token identity while balances are ${state}`, async () => {
			const rendered = await renderIntoDocument(<LivePortfolio entries={[{ market, balances: undefined, error: state === 'error' ? 'RPC unavailable' : undefined }]} balanceState={state} balanceError={state === 'error' ? 'RPC unavailable' : undefined} retryBalances={async () => undefined} nowSeconds={0n} />)
			cleanupRendered = rendered.cleanup
			expect(rendered.container.textContent).toContain(pool)
			expect(rendered.container.querySelector(`a[href="#/security-pool/${pool}"]`)).not.toBeNull()
			expect(rendered.container.textContent).not.toContain(shareToken)
			expect(rendered.container.textContent).not.toContain('Question ID')
			expect(rendered.container.textContent).not.toContain('Outcome token IDs')
			expect(rendered.container.textContent).not.toContain('0 shares')
			if (state === 'error') expect(rendered.container.textContent).toContain('RPC unavailable')
		})
	}

	test('links a pool whose own balance read failed to its details without exposing token identity', async () => {
		const rendered = await renderIntoDocument(<LivePortfolio entries={[{ market, balances: undefined, error: 'RPC unavailable' }]} balanceState='ready' balanceError={undefined} retryBalances={async () => undefined} nowSeconds={0n} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector(`a[href="#/security-pool/${pool}"]`)).not.toBeNull()
		expect(rendered.container.textContent).not.toContain(shareToken)
		expect(rendered.container.textContent).not.toContain('Outcome token IDs')
		expect(rendered.container.textContent).toContain('RPC unavailable')
	})

	test('names the selected universe when no position is found and links to switching it', async () => {
		const rendered = await renderIntoDocument(<LivePortfolio entries={[{ market, balances: { scope: shareBalanceScope(market), yes: 0n, no: 0n, invalid: 0n, lp: 0n }, error: undefined }]} balanceState='ready' balanceError={undefined} retryBalances={async () => undefined} nowSeconds={0n} universeId={0n} />)
		cleanupRendered = rendered.cleanup
		const empty = rendered.container.querySelector('.empty-state')
		expect(empty?.textContent).toContain('No positions in Genesis')
		expect(empty?.querySelector('a')?.getAttribute('href')).toBe('#/universe')
		expect(empty?.querySelector('a')?.textContent).toBe('Switch universe')
	})

	test('renders separate balance groups for each exact SecurityPool', async () => {
		const secondMarket = { ...market, pool: secondPool, shareToken: secondShareToken, universeId: 8n, questionId: 10n, title: 'Second scoped portfolio' }
		const firstBalances = { scope: { pool, shareToken, invalidTokenId: 1_792n, yesTokenId: 1_793n, noTokenId: 1_794n }, invalid: 3n * 10n ** 18n, yes: 1n * 10n ** 18n, no: 2n * 10n ** 18n, lp: 0n }
		const secondBalances = { scope: { pool: secondPool, shareToken: secondShareToken, invalidTokenId: 2_048n, yesTokenId: 2_049n, noTokenId: 2_050n }, invalid: 6n * 10n ** 18n, yes: 4n * 10n ** 18n, no: 5n * 10n ** 18n, lp: 0n }
		const rendered = await renderIntoDocument(
			<LivePortfolio
				entries={[
					{ market, balances: firstBalances, error: undefined },
					{ market: secondMarket, balances: secondBalances, error: undefined },
				]}
				balanceState='ready'
				balanceError={undefined}
				retryBalances={async () => undefined}
				nowSeconds={0n}
			/>,
		)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.textContent).toContain(pool)
		expect(rendered.container.textContent).toContain(secondPool)
		expect(rendered.container.textContent).not.toContain(shareToken)
		expect(rendered.container.textContent).not.toContain(secondShareToken)
		expect(rendered.container.textContent).not.toContain('Question ID')
		expect(rendered.container.textContent).toContain('1 Yes')
		expect(rendered.container.textContent).toContain('4 Yes')
		expect(rendered.container.textContent).not.toContain('LP claims')
		expect(rendered.container.querySelector(`a[href="#/market/${pool}"]`)?.textContent).toBe('Scoped portfolio')
		const redemption = Array.from(rendered.container.querySelectorAll('.metric-label')).find(field => field.textContent?.includes('redemption value'))
		expect(redemption).toBeDefined()
		expect(redemption?.closest('details')).toBeNull()
		expect(rendered.container.querySelector('details')?.open).toBe(false)
		expect(rendered.container.textContent).toContain('Maximum insured Yes exit0 ETH')
		expect(rendered.container.textContent).not.toContain('Transferring LP tokens')
		expect(rendered.container.querySelectorAll('[data-portfolio-pool]')).toHaveLength(2)
		expect(rendered.container.textContent).not.toContain('These balances and LP claims belong only')
		expect(rendered.container.textContent).not.toContain('live RPC')
		expect(rendered.container.textContent).not.toContain('Balances are grouped by SecurityPool')
	})

	test('separates stable outcome quantities, conditional payouts, and finalized redemption', async () => {
		const valuedMarket = { ...market, shareTokenSupplyAttoShares: 10n ** 18n, settlementCollateralAttoEth: 984_200_000_000_000_000n }
		for (const [questionOutcome, systemState, expected] of [
			[3, 0, '0.9842 ETH if the question resolves Yes'],
			[1, 0, '0.9842 ETH redeemable'],
			[2, 0, '0 ETH · lost'],
			[1, 1, 'winning payout; redemption unavailable'],
		] as const) {
			const rendered = await renderIntoDocument(<OutcomeHolding amount={10n ** 18n} outcome='YES' market={{ ...valuedMarket, questionOutcome, systemState }} />)
			expect(rendered.container.textContent).toContain('1 Yes')
			expect(rendered.container.textContent).toContain(expected)
			expect(rendered.container.textContent).toContain('1 Yes (')
			await rendered.cleanup()
		}
		const unavailable = await renderIntoDocument(<OutcomeHolding amount={10n ** 18n} outcome='YES' market={{ ...valuedMarket, loadError: 'RPC failed' }} />)
		expect(unavailable.container.textContent).toContain('Payout unavailable')
		expect(unavailable.container.textContent).not.toContain('0.9842 ETH')
		await unavailable.cleanup()
		const zero = await renderIntoDocument(<OutcomeHolding amount={0n} outcome='YES' market={valuedMarket} />)
		expect(zero.container.textContent).toBe('0 Yes (0 ETH)')
		await zero.cleanup()
	})

	test('explains conditional entry payout once without calling it a sale or guaranteed return', async () => {
		// 1 ETH buys about 2 YES in an even pool; each YES pays 0.9842 ETH at current backing if YES wins.
		const valued = liveMarketFixture({ settlementCollateralAttoEth: 984_200_000_000_000_000n })
		const estimate = ticketEstimateFor(valued, 'entry', '0.9842')
		const rendered = await renderIntoDocument(<TradeEstimatePanel estimate={estimate} market={valued} settings={DEFAULT_TRADE_SETTINGS} impactTier='low' impactAcknowledged={false} disabled={false} onAcknowledgeImpact={() => undefined} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.textContent).toContain('1.987158 Yes')
		expect(rendered.container.textContent).toContain('1.9558 ETH if the question resolves Yes')
		expect(rendered.container.textContent).toContain('Yes (1.9558 ETH if the question resolves Yes)')
		expect(rendered.container.textContent).not.toContain('sale')
	})

	test('shows only the holding fee estimate clamped to the fee end', async () => {
		const rendered = await renderIntoDocument(<BackingDetails market={{ ...market, shareTokenSupplyAttoShares: 10n ** 18n, settlementCollateralAttoEth: 10n ** 18n, valuation: { timestamp: 1n, feeEndTime: 2n, projectedCollateralAttoEth: 9n * 10n ** 17n } }} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('details')).toBeNull()
		expect(rendered.container.textContent).toBe('Holding fee over next 30 days10%')
		expect(rendered.container.textContent).not.toContain('Backing as of')
	})

	for (const [holdings, expected] of [
		[{ yes: 5n, no: 5n, invalid: 15n, lp: 0n }, '10% · 0.25 ETH–0.75 ETH depending on outcome'],
		[{ yes: 2n, no: 2n, invalid: 2n, lp: 0n }, '10% · 0.1 ETH'],
		[{ yes: 0n, no: 0n, invalid: 0n, lp: 0n }, '10% · 0 ETH'],
		[{ yes: 0n, no: 0n, invalid: 2n, lp: 1n }, '10% · 0.1 ETH–0.15 ETH depending on outcome'],
	] as const) {
		test(`shows the fee on wallet outcome holdings and LP claims: ${expected}`, async () => {
			const valued = { ...market, shareTokenSupplyAttoShares: 2n * 10n ** 18n, settlementCollateralAttoEth: 10n ** 18n, yesReserve: 4n * 10n ** 18n, noReserve: 6n * 10n ** 18n, lpTotalSupply: 2n * 10n ** 18n, valuation: { timestamp: 1n, feeEndTime: 2n, projectedCollateralAttoEth: 9n * 10n ** 17n } }
			const balances = { scope: shareBalanceScope(valued), yes: holdings.yes * 10n ** 18n, no: holdings.no * 10n ** 18n, invalid: holdings.invalid * 10n ** 18n, lp: holdings.lp * 10n ** 18n }
			const rendered = await renderIntoDocument(<BackingDetails market={valued} balances={balances} />)
			cleanupRendered = rendered.cleanup
			expect(rendered.container.textContent).toBe(`Holding fee on your holdings over next 30 days${expected}`)
		})
	}

	for (const [questionOutcome, projected, amount, expected] of [
		[1, 9n * 10n ** 17n, 2n * 10n ** 18n, '10% · 0.2 ETH'],
		[2, 9n * 10n ** 17n, 2n * 10n ** 18n, '10% · 0 ETH'],
		[3, 10n ** 18n, 2n * 10n ** 18n, '0% · 0 ETH'],
		[1, 9n * 10n ** 17n, 10n, '10% · <0.000001 ETH'],
	] as const) {
		test(`handles resolved, ended, and tiny holding fees: ${expected}`, async () => {
			const valued = { ...market, questionOutcome, shareTokenSupplyAttoShares: 10n ** 18n, settlementCollateralAttoEth: 10n ** 18n, valuation: { timestamp: 1n, feeEndTime: 2n, projectedCollateralAttoEth: projected } }
			const balances = { scope: shareBalanceScope(valued), yes: amount, no: 0n, invalid: 0n, lp: 0n }
			const rendered = await renderIntoDocument(<BackingDetails market={valued} balances={balances} />)
			cleanupRendered = rendered.cleanup
			expect(rendered.container.textContent).toBe(`Holding fee on your holdings over next 30 days${expected}`)
		})
	}

	test('connects the market fee metric to the current wallet balances', async () => {
		const valued = { ...market, valuation: { timestamp: 1n, feeEndTime: 2n, projectedCollateralAttoEth: 9n * 10n ** 19n } }
		const balances = { scope: shareBalanceScope(valued), yes: 10n ** 18n, no: 10n ** 18n, invalid: 10n ** 18n, lp: 0n }
		const rendered = await renderIntoDocument(<MarketPosition market={valued} holdings={{ balances, balanceState: 'ready', balanceError: undefined, retry: async () => undefined }} wallet={{ networkMismatchReason: undefined }} disabled={false} ownsBalanceError={false} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.textContent).toContain('Holding fee on your holdings over next 30 days10% · 0.1 ETH')
	})

	test('does not show fees for holdings from another market', async () => {
		const valued = { ...market, valuation: { timestamp: 1n, feeEndTime: 2n, projectedCollateralAttoEth: 9n * 10n ** 19n } }
		const balances = { scope: shareBalanceScope({ ...valued, pool: secondPool }), yes: 10n ** 18n, no: 0n, invalid: 0n, lp: 0n }
		const rendered = await renderIntoDocument(<BackingDetails market={valued} balances={balances} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.textContent).toBe('Holding fee over next 30 days10%')
	})

	for (const unavailable of [{ loadError: 'RPC unavailable' }, { valuation: undefined }, { shareTokenSupplyAttoShares: 0n }, { settlementCollateralAttoEth: 0n }]) {
		test(`does not invent a holding fee when ${Object.keys(unavailable)[0]} is unavailable`, async () => {
			const rendered = await renderIntoDocument(<BackingDetails market={{ ...market, shareTokenSupplyAttoShares: 10n ** 18n, settlementCollateralAttoEth: 10n ** 18n, valuation: { timestamp: 1n, feeEndTime: 2n, projectedCollateralAttoEth: 9n * 10n ** 17n }, ...unavailable }} />)
			cleanupRendered = rendered.cleanup
			expect(rendered.container.textContent).toBe('')
		})
	}

	test('keeps live pool identifiers and operational details in the security pool view', async () => {
		const rendered = await renderIntoDocument(<LiveSecurityPoolDetails market={{ ...market, feeBps: 47n, initialReportPriorityFeeAttoEthPerGas: 2_000_000_000n }} retry={() => undefined} workflowLocked={false} nowSeconds={market.endTime - 1n} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.textContent).toContain(pool)
		expect(rendered.container.textContent).toContain(shareToken)
		expect(rendered.container.textContent).toContain('Outcome token IDs')
		expect(rendered.container.textContent).toContain('Security pool stateOperational')
		expect(rendered.container.textContent).toContain('Security multiplier2×')
		expect(rendered.container.querySelector('details')?.open).toBe(false)
		const capacity = Array.from(rendered.container.querySelectorAll('.metric-label')).find(field => field.textContent?.includes('Minting capacity'))
		expect(capacity).toBeDefined()
		expect(capacity?.closest('details')).toBeNull()
		expect(rendered.container.querySelector('a.primary')?.closest('details')).toBeNull()
		expect(rendered.container.textContent).not.toContain('OutcomeNone (unresolved)')
		expect(rendered.container.querySelector(`a[href="#/create-market/${pool}"]`)?.textContent).toContain('Create market')
		expect(rendered.container.textContent).toContain('does not have a market yet')
		expect(rendered.container.textContent).toContain('Trading fee: 0.47%')
		expect(rendered.container.textContent).toContain('2\u00a0nanoETH per gas')
		expect(rendered.container.textContent).not.toContain('Checkpointed collateral')
		expect(rendered.container.querySelector('.route-header a[href="#/create-market"]')).not.toBeNull()
	})

	test('returns from a pool with a trading pair to the market lookup landing', async () => {
		const rendered = await renderIntoDocument(<LiveSecurityPoolDetails market={{ ...market, pair: `0x${'90'.repeat(20)}` }} retry={() => undefined} workflowLocked={false} nowSeconds={market.endTime - 1n} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.route-header a[href="#/market"]')).not.toBeNull()
		expect(rendered.container.querySelector(`a[href="#/market/${pool}"]`)?.textContent).toContain('Open market')
	})

	test('shows the deployed fee when an existing trading pool needs initialization', async () => {
		const rendered = await renderIntoDocument(<PairInitializationAction market={{ ...market, pair: `0x${'90'.repeat(20)}`, feeBps: 125n }} nowSeconds={market.endTime - 1n} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.textContent).toContain('needs its first liquidity')
		expect(rendered.container.textContent).toContain('Trading fee: 1.25%')
		expect(rendered.container.querySelector(`a[href="#/liquidity/${pool}"]`)?.textContent).toContain('Add first liquidity')
	})

	test('does not present placeholder operational facts when live pool reads fail', async () => {
		let retries = 0
		const failedMarket: LiveMarket = { ...market, loadError: 'pool RPC failed' }
		const rendered = await renderIntoDocument(<LiveSecurityPoolDetails market={failedMarket} retry={() => retries++} workflowLocked={false} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('Security pool details could not be loaded: pool RPC failed')
		expect(rendered.container.textContent).toContain(pool)
		expect(rendered.container.textContent).toContain(shareToken)
		expect(rendered.container.textContent).toContain('Outcome token IDs')
		expect(rendered.container.textContent).not.toContain('Security pool state')
		expect(rendered.container.textContent).not.toContain('Registered vaults')
		expect(rendered.container.textContent).not.toContain('Minting capacity')
		expect(rendered.container.textContent).not.toContain('Checkpointed collateral')
		const retry = rendered.container.querySelector('button:not([aria-label^="Copy"]):not(.favorite-toggle)')
		if (!(retry instanceof HTMLButtonElement)) throw new Error('Retry security pool button is unavailable')
		retry.click()
		expect(retries).toBe(1)
	})

	test('uses one truthful recovery state across failed pool retry combinations', async () => {
		const failedMarket: LiveMarket = { ...market, loadError: 'pool RPC failed' }
		const refreshing = await renderIntoDocument(<LiveSecurityPoolDetails market={failedMarket} refreshing retry={() => undefined} workflowLocked={false} />)
		expect(refreshing.container.querySelector('[role="status"]')?.textContent).toContain('Retrying security pool details')
		expect(refreshing.container.textContent).not.toContain('last successful result')
		expect(refreshing.container.querySelectorAll('button:not([aria-label^="Copy"]):not(.favorite-toggle)')).toHaveLength(0)
		await refreshing.cleanup()

		const failedRetry = await renderIntoDocument(<LiveSecurityPoolDetails market={failedMarket} refreshError='factory RPC failed' retry={() => undefined} workflowLocked={false} />)
		cleanupRendered = failedRetry.cleanup
		expect(failedRetry.container.querySelector('[role="alert"]')?.textContent).toContain('Security pool details could not be loaded: pool RPC failed. Latest retry failed: factory RPC failed')
		expect(failedRetry.container.textContent).not.toContain('last successful result')
		expect(failedRetry.container.querySelectorAll('button:not([aria-label^="Copy"]):not(.favorite-toggle)')).toHaveLength(1)
	})

	test('identifies stale pool details and offers recovery after refresh fails', async () => {
		let retries = 0
		const rendered = await renderIntoDocument(<LiveSecurityPoolDetails market={market} refreshError='factory RPC failed' retry={() => retries++} workflowLocked={false} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('Security pool refresh failed; showing the last successful result: factory RPC failed')
		expect(rendered.container.textContent).toContain('Security pool stateOperational')
		const retry = rendered.container.querySelector('button:not([aria-label^="Copy"]):not(.favorite-toggle)')
		if (!(retry instanceof HTMLButtonElement)) throw new Error('Retry refresh button is unavailable')
		retry.click()
		expect(retries).toBe(1)
	})

	test('keeps stale pool details identified while a refresh is pending', async () => {
		const rendered = await renderIntoDocument(<LiveSecurityPoolDetails market={market} refreshing retry={() => undefined} workflowLocked={false} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain('Refreshing security pool; showing the last successful result.')
		expect(rendered.container.querySelector('[aria-busy="true"]')).not.toBeNull()
		expect(rendered.container.textContent).toContain('Security pool stateOperational')
		expect(rendered.container.querySelector('button:not([aria-label^="Copy"]):not(.favorite-toggle)') === null).toBe(true)
	})

	test('shows a recoverable error when security pool discovery fails', async () => {
		let retries = 0
		const rendered = await renderIntoDocument(<SecurityPoolRouteEmptyState discoveryState='error' discoveryError='RPC unavailable' workflowLocked={false} retry={() => retries++} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('Security pool discovery failed: RPC unavailable')
		const retry = rendered.container.querySelector('button:not([aria-label^="Copy"]):not(.favorite-toggle)')
		if (!(retry instanceof HTMLButtonElement)) throw new Error('Retry discovery button is unavailable')
		retry.click()
		expect(retries).toBe(1)
	})

	test('announces when a routed live pool is unavailable in the selected universe', async () => {
		const rendered = await renderIntoDocument(<SecurityPoolRouteEmptyState discoveryState='ready' discoveryError={undefined} workflowLocked={false} retry={() => undefined} />)
		cleanupRendered = rendered.cleanup
		const empty = rendered.container.querySelector('.empty-state')
		// The pool route names what is wrong once, and offers both ways out.
		expect(empty?.querySelector('.empty-state-title')?.textContent).toBe('Security pool not in this universe')
		expect(empty?.textContent).not.toContain('No security pool selected')
		expect(Array.from(empty?.querySelectorAll('a') ?? []).map(link => [link.textContent, link.getAttribute('href')])).toEqual([
			['Switch universe', '#/universe'],
			['Markets', '#/market'],
		])
	})
})

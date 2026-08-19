import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { LivePortfolio, LiveSecurityPoolDetails, PairInitializationAction, SecurityPoolRouteEmptyState } from '../features/LiveTrading.tsx'
import { Portfolio } from '../features/Routes.tsx'
import { demoMarket } from '../demo/markets.ts'
import type { LiveMarket } from '../protocol/live.ts'
import { renderIntoDocument } from './test-support/renderIntoDocument.tsx'

const pool: Address = `0x${'12'.repeat(20)}`
const shareToken: Address = `0x${'34'.repeat(20)}`
const secondPool: Address = `0x${'56'.repeat(20)}`
const secondShareToken: Address = `0x${'78'.repeat(20)}`

const market: LiveMarket = {
	pool,
	pair: undefined,
	shareToken,
	universeId: 7n,
	questionId: 9n,
	title: 'Scoped portfolio',
	description: 'Scope fixture',
	endTime: 2n ** 255n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 1n,
	systemState: 0,
	awaitingForkContinuation: false,
	universeForkTime: 0n,
	vaultCount: 1n,
	shareTokenSupplyAttoShares: 0n,
	settlementCollateralAttoEth: 0n,
	currentRetentionRate: 10n ** 18n,
	totalCapacityOwnershipAttoRep: 1n,
	feeEligibleCapacityOwnershipAttoRep: 1n,
	mintingCapacityCeilingAttoEth: 1n,
	availableMintingCapacityAttoEth: 1n,
	feeBps: 30n,
	tradingStatus: 0,
	questionOutcome: 3,
	yesReserve: 0n,
	noReserve: 0n,
	lpTotalSupply: 0n,
}

describe('live portfolio scope', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRendered: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment('http://localhost/#/portfolio').cleanup
	})

	afterEach(async () => {
		await cleanupRendered?.()
		cleanupRendered = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	for (const state of ['disconnected', 'loading', 'error'] as const) {
		test(`links to pool details without exposing token identity while balances are ${state}`, async () => {
			const rendered = await renderIntoDocument(<LivePortfolio entries={[{ market, balances: undefined, error: state === 'error' ? 'RPC unavailable' : undefined }]} balanceState={state} balanceError={state === 'error' ? 'RPC unavailable' : undefined} retryBalances={async () => undefined} />)
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

	test('renders separate balance groups for each exact SecurityPool', async () => {
		const secondMarket = { ...market, pool: secondPool, shareToken: secondShareToken, universeId: 8n, questionId: 10n, title: 'Second scoped portfolio' }
		const firstBalances = { scope: { pool, shareToken, invalidTokenId: 1_792n, yesTokenId: 1_793n, noTokenId: 1_794n }, invalid: 3n * 10n ** 18n, yes: 1n * 10n ** 18n, no: 2n * 10n ** 18n, lp: 0n, approved: false, lpAllowance: 0n }
		const secondBalances = { scope: { pool: secondPool, shareToken: secondShareToken, invalidTokenId: 2_048n, yesTokenId: 2_049n, noTokenId: 2_050n }, invalid: 6n * 10n ** 18n, yes: 4n * 10n ** 18n, no: 5n * 10n ** 18n, lp: 0n, approved: false, lpAllowance: 0n }
		const rendered = await renderIntoDocument(
			<LivePortfolio
				entries={[
					{ market, balances: firstBalances, error: undefined },
					{ market: secondMarket, balances: secondBalances, error: undefined },
				]}
				balanceState='ready'
				balanceError={undefined}
				retryBalances={async () => undefined}
			/>,
		)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.textContent).toContain(pool)
		expect(rendered.container.textContent).toContain(secondPool)
		expect(rendered.container.textContent).not.toContain(shareToken)
		expect(rendered.container.textContent).not.toContain(secondShareToken)
		expect(rendered.container.textContent).not.toContain('Question ID')
		expect(rendered.container.textContent).toContain('1 YES')
		expect(rendered.container.textContent).toContain('4 YES')
		expect(rendered.container.querySelectorAll('[data-portfolio-pool]')).toHaveLength(2)
		expect(rendered.container.textContent).not.toContain('These balances and LP claims belong only')
		expect(rendered.container.textContent).not.toContain('live RPC')
		expect(rendered.container.textContent).not.toContain('Balances are grouped by SecurityPool')
	})

	test('shows demo balances only for the globally selected universe', async () => {
		const rendered = await renderIntoDocument(<Portfolio market={demoMarket('baseline')} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelectorAll('[data-portfolio-pool]')).toHaveLength(1)
		expect(rendered.container.textContent).not.toContain('Genesis universe')
		expect(rendered.container.textContent).not.toContain('Child universe · YES branch')
		expect(rendered.container.textContent).not.toContain('Total YES')
		expect(rendered.container.textContent).not.toContain('These balances and LP claims belong only')
	})

	test('keeps live pool identifiers and operational details in the security pool view', async () => {
		let selectedPool: Address | undefined
		const rendered = await renderIntoDocument(
			<LiveSecurityPoolDetails
				market={{ ...market, feeBps: 47n }}
				retry={() => undefined}
				workflowLocked={false}
				onSelect={selected => {
					selectedPool = selected.pool
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.textContent).toContain(pool)
		expect(rendered.container.textContent).toContain(shareToken)
		expect(rendered.container.textContent).toContain('Outcome token IDs')
		expect(rendered.container.textContent).toContain('System stateOperational')
		expect(rendered.container.textContent).toContain('Security multiplier2×')
		expect(rendered.container.textContent).not.toContain('OutcomeNone (unresolved)')
		expect(rendered.container.querySelector('a[href="#/liquidity"]')?.textContent).toContain('Deploy trading pool')
		expect(rendered.container.textContent).toContain('available to browse')
		expect(rendered.container.textContent).toContain('Trading fee: 0.47%')
		rendered.container.querySelector<HTMLAnchorElement>('a[href="#/liquidity"]')?.click()
		expect(selectedPool).toBe(pool)
	})

	test('shows the deployed fee when an existing trading pool needs initialization', async () => {
		const rendered = await renderIntoDocument(<PairInitializationAction market={{ ...market, pair: `0x${'90'.repeat(20)}`, feeBps: 125n }} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.textContent).toContain('needs initial liquidity')
		expect(rendered.container.textContent).toContain('Trading fee: 1.25%')
		expect(rendered.container.querySelector('a[href="#/liquidity"]')?.textContent).toContain('Initialize trading pool')
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
		expect(rendered.container.textContent).not.toContain('System state')
		expect(rendered.container.textContent).not.toContain('Registered vaults')
		expect(rendered.container.textContent).not.toContain('Minting capacity')
		expect(rendered.container.textContent).not.toContain('Checkpointed collateral')
		const retry = rendered.container.querySelector('button')
		if (!(retry instanceof HTMLButtonElement)) throw new Error('Retry security pool button is unavailable')
		retry.click()
		expect(retries).toBe(1)
	})

	test('uses one truthful recovery state across failed pool retry combinations', async () => {
		const failedMarket: LiveMarket = { ...market, loadError: 'pool RPC failed' }
		const refreshing = await renderIntoDocument(<LiveSecurityPoolDetails market={failedMarket} refreshing retry={() => undefined} workflowLocked={false} />)
		expect(refreshing.container.querySelector('[role="status"]')?.textContent).toContain('Retrying security pool details')
		expect(refreshing.container.textContent).not.toContain('last successful result')
		expect(refreshing.container.querySelectorAll('button')).toHaveLength(0)
		await refreshing.cleanup()

		const failedRetry = await renderIntoDocument(<LiveSecurityPoolDetails market={failedMarket} refreshError='factory RPC failed' retry={() => undefined} workflowLocked={false} />)
		cleanupRendered = failedRetry.cleanup
		expect(failedRetry.container.querySelector('[role="alert"]')?.textContent).toContain('Security pool details could not be loaded: pool RPC failed. Latest retry failed: factory RPC failed')
		expect(failedRetry.container.textContent).not.toContain('last successful result')
		expect(failedRetry.container.querySelectorAll('button')).toHaveLength(1)
	})

	test('identifies stale pool details and offers recovery after refresh fails', async () => {
		let retries = 0
		const rendered = await renderIntoDocument(<LiveSecurityPoolDetails market={market} refreshError='factory RPC failed' retry={() => retries++} workflowLocked={false} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('SecurityPool refresh failed; showing the last successful result: factory RPC failed')
		expect(rendered.container.textContent).toContain('System stateOperational')
		const retry = rendered.container.querySelector('button')
		if (!(retry instanceof HTMLButtonElement)) throw new Error('Retry refresh button is unavailable')
		retry.click()
		expect(retries).toBe(1)
	})

	test('keeps stale pool details identified while a refresh is pending', async () => {
		const rendered = await renderIntoDocument(<LiveSecurityPoolDetails market={market} refreshing retry={() => undefined} workflowLocked={false} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain('Refreshing security pool; showing the last successful result.')
		expect(rendered.container.querySelector('section')?.getAttribute('aria-busy')).toBe('true')
		expect(rendered.container.textContent).toContain('System stateOperational')
		expect(rendered.container.querySelector('button')).toBeNull()
	})

	test('shows a recoverable error when security pool discovery fails', async () => {
		let retries = 0
		const rendered = await renderIntoDocument(<SecurityPoolRouteEmptyState discoveryState='error' discoveryError='RPC unavailable' workflowLocked={false} retry={() => retries++} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('Security pool discovery failed: RPC unavailable')
		const retry = rendered.container.querySelector('button')
		if (!(retry instanceof HTMLButtonElement)) throw new Error('Retry discovery button is unavailable')
		retry.click()
		expect(retries).toBe(1)
	})

	test('announces when a routed live pool is unavailable in the selected universe', async () => {
		const rendered = await renderIntoDocument(<SecurityPoolRouteEmptyState discoveryState='ready' discoveryError={undefined} workflowLocked={false} retry={() => undefined} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain('This security pool is not available in the selected universe.')
	})
})

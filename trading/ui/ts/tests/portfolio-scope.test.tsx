import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { LivePortfolio } from '../features/LiveTrading.tsx'
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
		test(`keeps exact token identity visible while balances are ${state}`, async () => {
			const rendered = await renderIntoDocument(<LivePortfolio entries={[{ market, balances: undefined, error: state === 'error' ? 'RPC unavailable' : undefined }]} balanceState={state} balanceError={state === 'error' ? 'RPC unavailable' : undefined} retryBalances={async () => undefined} />)
			cleanupRendered = rendered.cleanup
			expect(rendered.container.textContent).toContain(pool)
			expect(rendered.container.textContent).toContain(shareToken)
			expect(rendered.container.textContent).toContain('Question ID9')
			expect(rendered.container.textContent).toContain('INVALID 1792 · YES 1793 · NO 1794')
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
		expect(rendered.container.textContent).toContain('Question ID9')
		expect(rendered.container.textContent).toContain('Question ID10')
		expect(rendered.container.textContent).toContain('1 shares')
		expect(rendered.container.textContent).toContain('4 shares')
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
})

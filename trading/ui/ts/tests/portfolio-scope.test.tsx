import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { LivePortfolio } from '../features/LiveTrading.tsx'
import type { LiveMarket } from '../protocol/live.ts'
import { renderIntoDocument } from './test-support/renderIntoDocument.tsx'

const pool: Address = `0x${'12'.repeat(20)}`
const shareToken: Address = `0x${'34'.repeat(20)}`

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
	activeVaultCount: 1n,
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
			const rendered = await renderIntoDocument(<LivePortfolio market={market} balances={undefined} balanceState={state} balanceError={state === 'error' ? 'RPC unavailable' : undefined} retryBalances={async () => undefined} />)
			cleanupRendered = rendered.cleanup
			expect(rendered.container.textContent).toContain(pool)
			expect(rendered.container.textContent).toContain(shareToken)
			expect(rendered.container.textContent).toContain('7 / 9')
			expect(rendered.container.textContent).toContain('INVALID 1792 · YES 1793 · NO 1794')
			expect(rendered.container.textContent).not.toContain('0 shares')
			if (state === 'error') expect(rendered.container.textContent).toContain('RPC unavailable')
		})
	}
})

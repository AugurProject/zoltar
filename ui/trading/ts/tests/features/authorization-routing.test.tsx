import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LivePositionControls } from '../../features/LivePositionControls.js'
import type { LiveBalances, LiveMarket } from '../../protocol/live.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { positionTicket } from '../support/positionTicket.js'

const pool = `0x${'11'.repeat(20)}` as Address
const pair = `0x${'22'.repeat(20)}` as Address
const shareToken = `0x${'33'.repeat(20)}` as Address
const market: LiveMarket = {
	pool,
	pair,
	shareToken,
	universeId: 7n,
	questionId: 9n,
	title: 'Authorization routing',
	description: 'Canonical authorization control fixture',
	endTime: 10_000n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 1n,
	systemState: 0,
	awaitingForkContinuation: false,
	universeForkTime: 0n,
	vaultCount: 1n,
	shareTokenSupplyAttoShares: 100n,
	settlementCollateralAttoEth: 100n,
	currentRetentionRate: 10n ** 18n,
	totalCapacityOwnershipAttoRep: 1n,
	feeEligibleCapacityOwnershipAttoRep: 1n,
	mintingCapacityCeilingAttoEth: 100n,
	availableMintingCapacityAttoEth: 100n,
	feeBps: 30n,
	tradingStatus: 0,
	questionOutcome: 3,
	yesReserve: 50n,
	noReserve: 50n,
	lpTotalSupply: 50n,
}
const balances: LiveBalances = {
	scope: { pool, shareToken, invalidTokenId: 1_792n, yesTokenId: 1_793n, noTokenId: 1_794n },
	invalid: 20n,
	yes: 20n,
	no: 20n,
	lp: 0n,
}

describe('trading authorization routing', () => {
	let cleanup: (() => Promise<void>) | undefined
	installDomTestLifecycle({ afterTest: async () => cleanup?.(), url: 'http://localhost/#/market' })

	async function renderExit() {
		const rendered = await renderIntoDocument(
			<LivePositionControls
				market={market}
				nowSeconds={1n}
				settings={DEFAULT_TRADE_SETTINGS}
				ticket={positionTicket({ mode: 'exit' })}
				wallet={{ connected: true, networkMismatchReason: undefined, actionLabel: 'Connect wallet', walletEthAttoEth: 10n ** 18n, connect: async () => undefined }}
				holdings={{ balances, balanceState: 'ready', balanceError: undefined, retry: async () => undefined }}
				externallyLocked={false}
			/>,
		)
		cleanup = rendered.cleanup
		return rendered.container
	}

	test('uses the receive flow without an approval action', async () => {
		const container = await renderExit()
		expect(container.textContent).toContain('Sell YES')
		expect(container.textContent).not.toContain('Preview trade')
		expect(container.textContent).not.toContain('Approve router for all outcome tokens')
	})
})

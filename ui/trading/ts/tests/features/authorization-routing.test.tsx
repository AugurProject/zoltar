import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LivePositionControls } from '../../features/LivePositionControls.js'
import type { LiveBalances, LiveMarket } from '../../protocol/live.js'

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
	description: 'V1 and V2 control fixture',
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
	approved: false,
	lpAllowance: 0n,
}

describe('trading authorization routing', () => {
	let cleanup: (() => Promise<void>) | undefined
	installDomTestLifecycle({ afterTest: async () => cleanup?.(), url: 'http://localhost/#/market' })

	async function renderExit(receiveBasedShareOperations: boolean) {
		const rendered = await renderIntoDocument(
			<LivePositionControls
				market={market}
				balances={balances}
				balanceState='ready'
				balanceError={undefined}
				mode='exit'
				side='YES'
				amount='1'
				slippage='0.5'
				transactionValidityMinutes='20'
				quote={undefined}
				state='idle'
				receiptWarning={undefined}
				transactionHash={undefined}
				externallyLocked={false}
				receiveBasedShareOperations={receiveBasedShareOperations}
				nowSeconds={1n}
				setMode={() => undefined}
				setSide={() => undefined}
				setAmount={() => undefined}
				setSlippage={() => undefined}
				setTransactionValidityMinutes={() => undefined}
				simulate={async () => undefined}
				approve={async () => undefined}
				submit={async () => undefined}
				retryBalances={async () => undefined}
			/>,
		)
		cleanup = rendered.cleanup
		return rendered.container
	}

	test('defaults capable V2 exits to the receive flow without an approval action', async () => {
		const container = await renderExit(true)
		expect(container.textContent).toContain('Preview trade')
		expect(container.textContent).not.toContain('Approve router for all outcome tokens')
	})

	test('retains the explicit approval fallback for legacy deployments', async () => {
		const container = await renderExit(false)
		expect(container.textContent).toContain('Approve router for all outcome tokens')
		expect(container.textContent).not.toContain('Preview trade')
	})
})

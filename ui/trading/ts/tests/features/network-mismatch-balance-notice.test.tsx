import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LivePositionControls } from '../../features/LivePositionControls.js'
import type { LiveMarket } from '../../protocol/live.js'

const pool = `0x${'11'.repeat(20)}` as Address
const pair = `0x${'22'.repeat(20)}` as Address
const shareToken = `0x${'33'.repeat(20)}` as Address
const market: LiveMarket = {
	pool,
	pair,
	shareToken,
	universeId: 7n,
	questionId: 9n,
	title: 'Network mismatch',
	description: 'Balance notice fixture',
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

function positionControls(networkMismatchReason: string | undefined) {
	return (
		<LivePositionControls
			market={market}
			balances={undefined}
			balanceState='error'
			balanceError='Balance refresh failed.'
			walletConnected
			networkMismatchReason={networkMismatchReason}
			walletEthAttoEth={undefined}
			mode='entry'
			side='YES'
			amount=''
			amountError={undefined}
			slippage='0.5'
			transactionValidityMinutes='20'
			quote={undefined}
			state='idle'
			message={undefined}
			receiptWarning={undefined}
			transactionHash={undefined}
			externallyLocked={false}
			nowSeconds={1n}
			setMode={() => undefined}
			setSide={() => undefined}
			setAmount={() => undefined}
			setSlippage={() => undefined}
			setTransactionValidityMinutes={() => undefined}
			simulate={async () => undefined}
			submit={async () => undefined}
			retryBalances={async () => undefined}
		/>
	)
}

describe('trading balance notices during a network mismatch', () => {
	let cleanup: (() => Promise<void>) | undefined
	installDomTestLifecycle({ afterTest: async () => cleanup?.(), url: 'http://localhost/#/market' })

	test('hides the balance failure while the wallet is on another chain and restores the retry once it is back', async () => {
		const rendered = await renderIntoDocument(positionControls('Switch to Browser simulation.'))
		cleanup = rendered.cleanup

		expect(rendered.container.textContent).toContain('Switch to Browser simulation.')
		expect(rendered.container.textContent).not.toContain('Balance refresh failed.')
		expect(rendered.container.textContent).not.toContain('Retry balances')

		await act(() => render(positionControls(undefined), rendered.container))

		expect(rendered.container.textContent).toContain('Balance refresh failed.')
		expect(rendered.container.querySelector('button.secondary')?.textContent).toBe('Retry balances')
	})
})

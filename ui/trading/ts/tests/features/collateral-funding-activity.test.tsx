import { beforeEach, describe, expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, custom, http, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { act } from 'preact/test-utils'
import { getActiveNetworkProfile, installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createReadContractStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { transactionActivity } from '@zoltar/ui-core-shared/transactions/transactionActivityStore.js'
import type { LiveWorkflowContext } from '../../features/live/liveTradingTypes.js'
import { useCollateralFunding } from '../../features/live/useCollateralFunding.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { liveMarketFixture } from '../support/liveMarketFixture.js'

const account: Address = `0x${'11'.repeat(20)}`
const resetHash: Hash = `0x${'a1'.repeat(32)}`
const approvalHash: Hash = `0x${'a2'.repeat(32)}`
const configuration = deploymentConfigurationFixture()

type Funding = ReturnType<typeof useCollateralFunding>

function Probe({ context, market, onFunding }: { context: LiveWorkflowContext; market: LiveWorkflowContext['market']; onFunding: (funding: Funding) => void }) {
	onFunding(useCollateralFunding(market, 5_000_000n, context, true))
	return null
}

describe('collateral funding activity', () => {
	// The hook reads the wallet's collateral balance and allowance through the connected read client.
	const readClient = createPublicClient({ transport: http('https://example.test') }).extend(() => ({ readContract: createReadContractStub(() => 1_000_000n) }))
	const lifecycle = installDomTestLifecycle({ beforeTest: () => void installActiveEnvironmentForTesting({ ...createFakeBackend({ accountAddress: account }), createReadClient: () => readClient }), afterTest: resetActiveEnvironmentForTesting })
	beforeEach(() => {
		transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
	})

	async function renderFunding(receipt: () => Promise<{ status: 'success' | 'reverted' }> = async () => ({ status: 'success' })) {
		const usdt = getActiveNetworkProfile().usdtAddress
		if (usdt === undefined) throw new Error('Expected a configured USDT address')
		const market = liveMarketFixture({ collateral: { token: usdt, symbol: 'USDT', decimals: 6, native: false } })
		let allowance = 1_000_000n
		const walletClient = {
			...createWalletClient({ account, transport: custom({ request: async () => undefined }) }),
			readContract: async () => allowance,
			writeContract: async ({ args }: { args: readonly [Address, bigint] }) => {
				allowance = args[1]
				return allowance === 0n ? resetHash : approvalHash
			},
			waitForTransactionReceipt: receipt,
		}
		let funding: Funding | undefined
		const context: LiveWorkflowContext = {
			configuration,
			market,
			balanceState: 'ready',
			account,
			walletClient,
			externallyLocked: false,
			settings: DEFAULT_TRADE_SETTINGS,
			nowSeconds: 1n,
			refresh: async () => undefined,
			onKnownReceipt: () => undefined,
			executeWithCurrentWalletContext: async (_account, _networkFailure, _accountFailure, action) => await action(),
			createGuardedWalletWrite: () => async write => await write(),
			onWorkflowLockChange: () => undefined,
		}
		const rendered = await renderIntoDocument(
			<Probe
				context={context}
				market={market}
				onFunding={next => {
					funding = next
				}}
			/>,
		)
		lifecycle.trackRendered(rendered)
		const approve = async (amount: bigint) => {
			if (funding === undefined) throw new Error('Collateral funding did not render')
			await funding.approve(amount)
		}
		return { approve }
	}
	const rows = () => transactionActivity.value.entries.map(entry => ({ hash: entry.hash, status: entry.status, title: entry.title }))

	test('records a reset under its own title and the approval after it as an approval', async () => {
		const funding = await renderFunding()
		await act(() => funding.approve(0n))
		await act(() => funding.approve(5_000_000n))
		// Newest first: the approval that follows the reset keeps its own row and title.
		expect(rows()).toEqual([
			{ hash: approvalHash, status: 'confirmed', title: 'Collateral approval' },
			{ hash: resetHash, status: 'confirmed', title: 'USDT approval reset' },
		])
	})

	test('a pending reset reads as the action and only a confirmed one as its result', async () => {
		const receipt = createDeferred<{ status: 'success' }>()
		const funding = await renderFunding(async () => await receipt.promise)
		let pending: Promise<void> | undefined
		await act(() => {
			pending = funding.approve(0n)
		})
		await waitFor(() => expect(rows()).toEqual([{ hash: resetHash, status: 'pending', title: 'Reset USDT approval' }]))
		await act(async () => {
			receipt.resolve({ status: 'success' })
			await pending
		})
		expect(rows()).toEqual([{ hash: resetHash, status: 'confirmed', title: 'USDT approval reset' }])
	})

	test('a reverted reset keeps the action title instead of claiming the reset happened', async () => {
		const funding = await renderFunding(async () => ({ status: 'reverted' }))
		await act(() => funding.approve(0n))
		expect(rows()).toEqual([{ hash: resetHash, status: 'failed', title: 'Reset USDT approval' }])
	})

	test('names the reset when its receipt cannot be confirmed', async () => {
		const funding = await renderFunding(async () => {
			throw new Error('Receipt unavailable')
		})
		await act(() => funding.approve(0n))
		expect(rows()).toEqual([{ hash: resetHash, status: 'pending', title: 'Reset USDT approval' }])
	})
})

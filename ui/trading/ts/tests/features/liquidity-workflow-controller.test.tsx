import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { act } from 'preact/test-utils'
import { render, type ComponentChildren } from 'preact'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { LiveMarket } from '../../protocol/live.js'
import type { LiveLiquidityServices } from '../../features/LiveLiquidityControls.js'
import { useLiquidityWorkflowController } from '../../features/live/useLiquidityWorkflowController.js'
// Longer than the automatic quote debounce in useQuotedTransaction.
const QUOTE_SETTLE_MILLISECONDS = 400
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'

const account = `0x${'11'.repeat(20)}` as Address
const transactionHash = `0x${'88'.repeat(32)}` as Hash
const blockHash = `0x${'99'.repeat(32)}` as Hash
const configuration: DeploymentConfiguration = {
	chainId: 31_337,
	chainName: 'Local',
	rpcUrl: 'http://127.0.0.1:8545',
	securityPoolFactory: `0x${'22'.repeat(20)}` as Address,
	factory: `0x${'33'.repeat(20)}` as Address,
	router: `0x${'44'.repeat(20)}` as Address,
	feeBps: 30,
}
const market: LiveMarket = {
	pool: `0x${'55'.repeat(20)}` as Address,
	pair: `0x${'66'.repeat(20)}` as Address,
	shareToken: `0x${'77'.repeat(20)}` as Address,
	universeId: 1n,
	questionId: 2n,
	title: 'Workflow market',
	description: 'Controller state fixture',
	endTime: 2n ** 255n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 2_000_000_000n,
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
	lpTotalSupply: 100n,
}

function deferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (error: Error) => void = () => undefined
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

function liquidityQuote(amount: bigint) {
	return {
		blockNumber: 12n,
		blockHash,
		operation: 'add' as const,
		amount,
		conditionalYesBps: 5_000n,
		deadline: 1_000_000n,
		slippageBps: 50n,
		market,
		result: { completeSetShares: amount, yesUsed: amount, noUsed: amount, yesReturned: 0n, noReturned: 0n, invalidInsurance: amount, liquidity: amount },
		expectedLiquidity: amount,
		expectedYes: 0n,
		expectedNo: 0n,
		expectedYesDeposit: amount,
		expectedNoDeposit: amount,
	}
}

type Controller = ReturnType<typeof useLiquidityWorkflowController>

type ProbeProps = Readonly<{ walletClient: Parameters<typeof useLiquidityWorkflowController>[0]['walletClient']; services: LiveLiquidityServices; onController: (controller: Controller) => void; onLockChange: (locked: boolean) => void; market: LiveMarket }>

// One stable component type so re-rendering with a new market object updates the hook instead of remounting it.
function Probe({ walletClient, services, onController, onLockChange, market: probeMarket }: ProbeProps) {
	const controller = useLiquidityWorkflowController({
		configuration,
		market: probeMarket,
		balanceState: 'ready',
		account,
		walletClient,
		externallyLocked: false,
		nowSeconds: 1n,
		settings: DEFAULT_TRADE_SETTINGS,
		refresh: async () => undefined,
		onKnownReceipt: () => undefined,
		executeWithCurrentWalletContext: async (_account, _networkFailure, _accountFailure, action) => await action(),
		createGuardedWalletWrite: () => async write => await write(),
		onWorkflowLockChange: onLockChange,
		services,
	})
	onController(controller)
	return null
}

function controllerProbe(walletClient: ProbeProps['walletClient'], services: LiveLiquidityServices, onController: (controller: Controller) => void, onLockChange: (locked: boolean) => void, probeMarket: LiveMarket = market): ComponentChildren {
	return <Probe walletClient={walletClient} services={services} onController={onController} onLockChange={onLockChange} market={probeMarket} />
}

async function flush() {
	await act(async () => {
		await Promise.resolve()
		await Promise.resolve()
	})
}

// Waits past the quote debounce so the automatic quote request starts and settles.
async function settleQuote() {
	await act(async () => {
		await Bun.sleep(QUOTE_SETTLE_MILLISECONDS)
	})
	await flush()
}

describe('liquidity workflow controller state', () => {
	installDomTestLifecycle()

	test('quotes automatically after typing settles and never lets an older quote replace a newer one', async () => {
		const firstQuote = deferred<ReturnType<typeof liquidityQuote>>()
		const requested: bigint[] = []
		const services: LiveLiquidityServices = {
			publicErrorMessage: caught => (caught instanceof Error ? caught.message : 'unknown error'),
			simulateLiquidity: async (_client, _configuration, _market, _account, _operation, amount) => {
				requested.push(amount)
				if (requested.length === 1) return await firstQuote.promise
				return liquidityQuote(amount)
			},
			submitFreshLiquidity: async () => transactionHash,
		}
		const walletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		let controller: Controller | undefined
		const rendered = await renderIntoDocument(
			controllerProbe(
				walletClient,
				services,
				value => (controller = value),
				() => undefined,
			),
		)
		expect(controller?.amount).toBe('')
		expect(controller?.transaction.quoteState).toBe('idle')

		// Rapid typing only quotes the settled amount.
		await act(() => controller?.updateAmount('0.001'))
		await act(() => controller?.updateAmount('0.01'))
		expect(controller?.transaction.quoteState).toBe('loading')
		await settleQuote()
		expect(requested).toEqual([10_000_000_000_000_000n])
		expect(controller?.transaction.quoteState).toBe('loading')

		await act(() => controller?.updateAmount('0.02'))
		await settleQuote()
		expect(controller?.transaction.quoteState).toBe('ready')
		expect(controller?.transaction.quote?.amount).toBe(20_000_000_000_000_000n)
		firstQuote.resolve(liquidityQuote(10_000_000_000_000_000n))
		await flush()
		expect(controller?.transaction.quote?.amount).toBe(20_000_000_000_000_000n)
		await rendered.cleanup()
	})

	test('keeps an LP removal quote across identical refreshes and re-quotes when the pool basis moves', async () => {
		const walletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const removals: bigint[] = []
		const services: LiveLiquidityServices = {
			publicErrorMessage: caught => (caught instanceof Error ? caught.message : 'unknown error'),
			simulateLiquidity: async (_client, _configuration, quotedMarket, _account, operation, amount) => {
				removals.push(amount)
				return { ...liquidityQuote(amount), operation, market: quotedMarket }
			},
			submitFreshLiquidity: async () => transactionHash,
		}
		let controller: Controller | undefined
		// 0.01 LP uses fixed genesis normalization, independently of ETH backing.
		const ratedMarket: LiveMarket = { ...market, shareTokenSupplyAttoShares: 1_000n, settlementCollateralAttoEth: 100n }
		const rendered = await renderIntoDocument(
			controllerProbe(
				walletClient,
				services,
				value => (controller = value),
				() => undefined,
				ratedMarket,
			),
		)
		await act(() => controller?.selectOperation('remove'))
		await act(() => controller?.updateAmount('0.01'))
		await settleQuote()
		expect(removals).toEqual([10n ** 34n])
		expect(controller?.transaction.quoteState).toBe('ready')
		// A background refresh that only rebuilds the market object keeps the quote.
		await act(() =>
			render(
				controllerProbe(
					walletClient,
					services,
					value => (controller = value),
					() => undefined,
					{ ...ratedMarket },
				),
				rendered.container,
			),
		)
		await settleQuote()
		expect(removals).toHaveLength(1)
		expect(controller?.transaction.quote?.amount).toBe(10n ** 34n)
		// Moving the pool rate retires the quote at once and prices the same LP amount again.
		await act(() =>
			render(
				controllerProbe(
					walletClient,
					services,
					value => (controller = value),
					() => undefined,
					{ ...ratedMarket, settlementCollateralAttoEth: 90n },
				),
				rendered.container,
			),
		)
		expect(controller?.transaction.quote).toBeUndefined()
		expect(controller?.transaction.quoteState).toBe('loading')
		await settleQuote()
		expect(removals).toEqual([10n ** 34n, 10n ** 34n])
		expect(controller?.transaction.quoteState).toBe('ready')
		await rendered.cleanup()
	})

	test('simulates again before signing and represents a broadcast with an unknown receipt as one locked uncertain state', async () => {
		const receiptFailure = deferred<{ status: 'success' | 'reverted' }>()
		const baseWalletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const walletClient = { ...baseWalletClient, waitForTransactionReceipt: async () => await receiptFailure.promise }
		let simulations = 0
		const services: LiveLiquidityServices = {
			publicErrorMessage: caught => (caught instanceof Error ? caught.message : 'unknown error'),
			simulateLiquidity: async (_client, _configuration, _market, _account, _operation, amount) => {
				simulations++
				return { ...liquidityQuote(amount), deadline: BigInt(simulations) }
			},
			submitFreshLiquidity: async (_client, _configuration, _account, quote, guardedWrite) => {
				// The submitted quote carries the fresh deadline from the pre-signing simulation.
				expect(quote.deadline).toBe(2n)
				return await guardedWrite(async () => transactionHash)
			},
		}
		const locks: boolean[] = []
		let controller: Controller | undefined
		const rendered = await renderIntoDocument(
			controllerProbe(
				walletClient,
				services,
				value => (controller = value),
				locked => locks.push(locked),
			),
		)

		await act(() => controller?.updateAmount('0.01'))
		await settleQuote()
		const submission = controller?.submit()
		await flush()
		await act(async () => Bun.sleep(10))
		expect(simulations).toBe(2)
		expect(controller?.transaction.state).toBe('pending')
		expect(controller?.transaction.transactionHash).toBe(transactionHash)
		receiptFailure.reject(new Error('receipt RPC unavailable'))
		await submission
		await flush()
		expect(controller?.transaction.state).toBe('error')
		expect(controller?.transaction.transactionHash).toBe(transactionHash)
		expect(controller?.transaction.receiptWarning).toContain('Do not resubmit')
		expect(controller?.transaction.error).toBeUndefined()
		expect(controller?.transaction.workflowLocked).toBeTrue()
		expect(locks.at(-1)).toBeTrue()

		await act(() => controller?.updateAmount('0.04'))
		expect(controller?.amount).toBe('0.01')
		expect(controller?.transaction.transactionHash).toBe(transactionHash)
		await rendered.cleanup()
	})
})

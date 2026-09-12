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

describe('liquidity workflow controller state', () => {
	installDomTestLifecycle()

	test('rejects an overlapping stale simulation result and ignores completion after unmount', async () => {
		const firstSimulation = deferred<ReturnType<typeof liquidityQuote>>()
		const thirdSimulation = deferred<ReturnType<typeof liquidityQuote>>()
		let calls = 0
		const services: LiveLiquidityServices = {
			publicErrorMessage: caught => (caught instanceof Error ? caught.message : 'unknown error'),
			simulateLiquidity: async (_client, _configuration, _market, _account, _operation, amount) => {
				calls++
				if (calls === 1) return await firstSimulation.promise
				if (calls === 3) return await thirdSimulation.promise
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

		const staleSimulation = controller?.simulateCurrent()
		await flush()
		expect(controller?.state).toBe('simulating')
		await act(() => controller?.updateAmount('0.02'))
		await act(async () => controller?.simulateCurrent())
		expect(controller?.state).toBe('ready')
		expect(controller?.quote?.amount).toBe(20_000_000_000_000_000n)
		firstSimulation.resolve(liquidityQuote(10_000_000_000_000_000n))
		await staleSimulation
		await flush()
		expect(controller?.quote?.amount).toBe(20_000_000_000_000_000n)

		await act(() => controller?.updateAmount('0.03'))
		const pendingSimulation = controller?.simulateCurrent()
		await flush()
		expect(controller?.state).toBe('simulating')
		await rendered.cleanup()
		thirdSimulation.resolve(liquidityQuote(30_000_000_000_000_000n))
		await pendingSimulation
	})

	test('keeps an LP removal quote comparable across rate refreshes and retires it when the pool basis moves', async () => {
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
		// Ten attoShares per attoETH: 0.01 ETH of LP converts to 10^17 LP units.
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
		await act(async () => controller?.simulateCurrent())
		expect(removals).toEqual([10n ** 17n])
		expect(controller?.state).toBe('ready')
		// A background refresh that only rebuilds the market object keeps the quote submittable.
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
		await flush()
		expect(controller?.quote?.amount).toBe(10n ** 17n)
		// Moving the pool rate changes what the entered value means, so the quote is retired instead of failing at submit.
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
		await flush()
		expect(controller?.quote).toBeUndefined()
		expect(controller?.state).toBe('idle')
		expect(controller?.parsed).toBe(111_111_111_111_111_111n)
		await rendered.cleanup()
	})

	test('represents a broadcast with an unknown receipt as one locked uncertain state', async () => {
		const receiptFailure = deferred<{ status: 'success' | 'reverted' }>()
		const baseWalletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const walletClient = { ...baseWalletClient, waitForTransactionReceipt: async () => await receiptFailure.promise }
		const services: LiveLiquidityServices = {
			publicErrorMessage: caught => (caught instanceof Error ? caught.message : 'unknown error'),
			simulateLiquidity: async (_client, _configuration, _market, _account, _operation, amount) => liquidityQuote(amount),
			submitFreshLiquidity: async (_client, _configuration, _account, _quote, guardedWrite) => await guardedWrite(async () => transactionHash),
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

		await act(async () => controller?.simulateCurrent())
		const submission = controller?.submit()
		await flush()
		await act(async () => Bun.sleep(10))
		expect(controller?.state).toBe('pending')
		expect(controller?.transactionHash).toBe(transactionHash)
		receiptFailure.reject(new Error('receipt RPC unavailable'))
		await submission
		await flush()
		expect(controller?.state).toBe('error')
		expect(controller?.transactionHash).toBe(transactionHash)
		expect(controller?.receiptWarning).toContain('Do not resubmit')
		expect(controller?.error).toBeUndefined()
		expect(controller?.workflowLocked).toBeTrue()
		expect(locks.at(-1)).toBeTrue()

		controller?.updateAmount('0.04')
		expect(controller?.transactionHash).toBe(transactionHash)
		await rendered.cleanup()
	})
})

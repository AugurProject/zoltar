import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { act } from 'preact/test-utils'
import { render, type ComponentChildren } from 'preact'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { LiveMarket } from '../../protocol/live.js'
import { LiveLiquidityControls, type LiveLiquidityServices } from '../../features/LiveLiquidityControls.js'
import { useLiquidityWorkflowController } from '../../features/live/useLiquidityWorkflowController.js'
// Longer than the automatic quote debounce in useQuotedTransaction.
const QUOTE_SETTLE_MILLISECONDS = 400
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { smallReserveMarketFixture } from '../support/liveMarketFixture.js'

const account = `0x${'11'.repeat(20)}` as Address
const transactionHash = `0x${'88'.repeat(32)}` as Hash
const blockHash = `0x${'99'.repeat(32)}` as Hash
const configuration = deploymentConfigurationFixture({ securityPoolFactory: `0x${'22'.repeat(20)}`, factory: `0x${'33'.repeat(20)}`, router: `0x${'44'.repeat(20)}` })
const market = smallReserveMarketFixture({
	pool: `0x${'55'.repeat(20)}`,
	pair: `0x${'66'.repeat(20)}`,
	shareToken: `0x${'77'.repeat(20)}`,
	title: 'Workflow market',
	description: 'Controller state fixture',
	initialReportPriorityFeeAttoEthPerGas: 2_000_000_000n,
	lpTotalSupply: 100n,
})

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

	test('simulates initialization only at submission and retains the local preview LP bound', async () => {
		let controller: Controller | undefined
		let simulations = 0
		let sends = 0
		const initialMarket = { ...market, pair: undefined, lpTotalSupply: 0n }
		const baseClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const walletClient = { ...baseClient, waitForTransactionReceipt: async () => ({ status: 'success' as const }) }
		const services: LiveLiquidityServices = {
			publicErrorMessage: String,
			simulateLiquidity: async (_client, _configuration, quotedMarket, _account, operation, amount) => {
				simulations += 1
				return { ...liquidityQuote(amount), market: quotedMarket, operation, expectedLiquidity: amount * 2n }
			},
			submitFreshLiquidity: async (_client, _configuration, _account, quote, guardedWrite) => {
				expect(quote.expectedLiquidity).toBe(10n ** 16n - 1_000n)
				expect(quote.deadline).toBe(1_000_000n)
				return await guardedWrite(async () => {
					sends += 1
					return transactionHash
				})
			},
		}
		const rendered = await renderIntoDocument(
			controllerProbe(
				walletClient,
				services,
				next => {
					controller = next
				},
				() => undefined,
				initialMarket,
			),
		)
		try {
			await act(() => controller?.updateAmount('0.01'))
			await settleQuote()
			expect(simulations).toBe(0)
			expect(controller?.estimate?.operation).toBe('initialize')
			await act(async () => await controller?.submit())
			expect(simulations).toBe(1)
			expect(sends).toBe(1)
			expect(controller?.transaction.state).toBe('confirmed')
		} finally {
			await rendered.cleanup()
		}
	})

	test('retries a failed quote without changing the amount or sending a transaction', async () => {
		let current: Controller | undefined
		let calls = 0
		const services: LiveLiquidityServices = {
			publicErrorMessage: String,
			simulateLiquidity: async (_client, _configuration, _market, _account, _operation, amount) => {
				if (++calls === 1) throw new Error('RPC unavailable')
				return liquidityQuote(amount)
			},
			submitFreshLiquidity: async () => {
				throw new Error('Unexpected send')
			},
		}
		const walletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const rendered = await renderIntoDocument(
			controllerProbe(
				walletClient,
				services,
				value => {
					current = value
				},
				() => undefined,
			),
		)
		try {
			await act(() => current?.updateAmount('0.1'))
			await settleQuote()
			expect(current?.transaction.quoteState).toBe('error')
			await act(() => current?.transaction.retryQuote())
			await settleQuote()
			expect(current?.amount).toBe('0.1')
			expect(current?.transaction.quoteState).toBe('ready')
			expect(calls).toBe(2)
		} finally {
			await rendered.cleanup()
		}
	})

	test('associates amount errors with the liquidity field and offers a decimal price keypad', async () => {
		const rendered = await renderIntoDocument(
			<LiveLiquidityControls
				configuration={configuration}
				market={{ ...market, lpTotalSupply: 0n }}
				balances={undefined}
				balanceState='ready'
				balanceError={undefined}
				account={account}
				walletClient={undefined}
				networkMismatchReason={undefined}
				walletEthAttoEth={10n ** 18n}
				wallet={{ actionLabel: 'Connect wallet', connect: async () => undefined }}
				settings={DEFAULT_TRADE_SETTINGS}
				externallyLocked={false}
				nowSeconds={1n}
				refresh={async () => undefined}
				onKnownReceipt={() => undefined}
				executeWithCurrentWalletContext={async (_account, _network, _wallet, action) => await action()}
				createGuardedWalletWrite={() => async write => await write()}
				retryBalances={async () => undefined}
				onWorkflowLockChange={() => undefined}
			/>,
		)
		try {
			const amount = rendered.container.querySelector('input[name="amount"]')
			if (!(amount instanceof HTMLInputElement)) throw new Error('Missing amount')
			await act(() => {
				amount.value = '0'
				amount.dispatchEvent(new Event('input', { bubbles: true }))
			})
			expect(amount.getAttribute('aria-invalid')).toBe('true')
			expect(amount.getAttribute('aria-describedby')).toBeTruthy()
			expect(rendered.container.querySelector('input[name="probability"]')?.getAttribute('inputmode')).toBe('decimal')
		} finally {
			await rendered.cleanup()
		}
	})

	test('selects Add when initialization refreshes the pool state', async () => {
		const services: LiveLiquidityServices = { publicErrorMessage: String, simulateLiquidity: async (_client, _configuration, selected, _account, operation, amount) => ({ ...liquidityQuote(amount), operation, market: selected }), submitFreshLiquidity: async () => transactionHash }
		const walletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		let controller: Controller | undefined
		const onController = (next: Controller) => {
			controller = next
		}
		const onLockChange = () => undefined
		const rendered = await renderIntoDocument(<Probe walletClient={walletClient} services={services} onController={onController} onLockChange={onLockChange} market={{ ...market, lpTotalSupply: 0n }} />)
		try {
			expect(controller?.operation).toBe('initialize')
			await act(() => render(<Probe walletClient={walletClient} services={services} onController={onController} onLockChange={onLockChange} market={market} />, rendered.container))
			expect(controller?.operation).toBe('add')
			await act(() => controller?.selectOperation('remove'))
			await act(() => render(<Probe walletClient={walletClient} services={services} onController={onController} onLockChange={onLockChange} market={{ ...market }} />, rendered.container))
			expect(controller?.operation).toBe('remove')
		} finally {
			await rendered.cleanup()
		}
	})

	test('quotes automatically after typing settles and never lets an older quote replace a newer one', async () => {
		const firstQuote = createDeferred<ReturnType<typeof liquidityQuote>>()
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
		// 0.01 LP uses 18 decimal places, independently of ETH backing.
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
		expect(removals).toEqual([10n ** 16n])
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
		expect(controller?.transaction.quote?.amount).toBe(10n ** 16n)
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
		expect(removals).toEqual([10n ** 16n, 10n ** 16n])
		expect(controller?.transaction.quoteState).toBe('ready')
		await rendered.cleanup()
	})

	test('retains the market lock when its tab unmounts during wallet approval', async () => {
		const signature = createDeferred<Hash>()
		const signatureRequested = createDeferred<void>()
		const baseWalletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const walletClient = { ...baseWalletClient, waitForTransactionReceipt: async () => ({ status: 'success' as const }) }
		const services: LiveLiquidityServices = {
			publicErrorMessage: String,
			simulateLiquidity: async (_client, _configuration, _market, _account, _operation, amount) => liquidityQuote(amount),
			submitFreshLiquidity: async (_client, _configuration, _account, _quote, guardedWrite) =>
				await guardedWrite(async () => {
					signatureRequested.resolve()
					return await signature.promise
				}),
		}
		const locks: boolean[] = []
		let controller: Controller | undefined
		const rendered = await renderIntoDocument(
			controllerProbe(
				walletClient,
				services,
				value => {
					controller = value
				},
				locked => locks.push(locked),
			),
		)
		await act(() => controller?.updateAmount('0.01'))
		await settleQuote()
		const submission = controller?.submit()
		await signatureRequested.promise
		await rendered.cleanup()
		expect(locks.at(-1)).toBe(true)
		signature.reject(new Error('User rejected request'))
		await submission
		expect(locks.at(-1)).toBe(false)
	})

	test('simulates again before signing and represents a broadcast with an unknown receipt as one locked uncertain state', async () => {
		const receiptFailure = createDeferred<{ status: 'success' | 'reverted' }>()
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

	test('prices the pool again after a failed submission instead of resubmitting the stale quote', async () => {
		const walletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		let quotes = 0
		const services: LiveLiquidityServices = {
			publicErrorMessage: caught => (caught instanceof Error ? caught.message : 'unknown error'),
			simulateLiquidity: async (_client, _configuration, _market, _account, _operation, amount) => {
				quotes++
				return liquidityQuote(amount)
			},
			submitFreshLiquidity: async () => {
				throw new Error('Refreshed quote no longer satisfies the approved minimum LP tokens')
			},
		}
		let controller: Controller | undefined
		const rendered = await renderIntoDocument(
			controllerProbe(
				walletClient,
				services,
				value => (controller = value),
				() => undefined,
			),
		)
		await act(() => controller?.updateAmount('0.01'))
		await settleQuote()
		expect(quotes).toBe(1)
		await act(async () => controller?.submit())
		await flush()
		expect(controller?.transaction.state).toBe('error')
		expect(controller?.transaction.error).toContain('The price moved past your slippage limit.')
		// One pre-signing simulation, then a fresh automatic quote for the same inputs.
		expect(quotes).toBe(2)
		expect(controller?.transaction.quote).toBeUndefined()
		await settleQuote()
		expect(quotes).toBe(3)
		expect(controller?.transaction.quoteState).toBe('ready')
		await rendered.cleanup()
	})
})

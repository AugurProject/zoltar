import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { act } from 'preact/test-utils'
import { render, type ComponentChildren } from 'preact'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { LiveMarket } from '../../protocol/live.js'
import { LiveLiquidityControls, type LiveLiquidityServices } from '../../features/LiveLiquidityControls.js'
import { useLiquidityWorkflowController } from '../../features/live/useLiquidityWorkflowController.js'
// Wait past the former quote debounce to catch accidental background requests.
const QUOTE_SETTLE_MILLISECONDS = 400
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { smallReserveMarketFixture } from '../support/liveMarketFixture.js'

const account = `0x${'11'.repeat(20)}` as Address
const transactionHash = `0x${'88'.repeat(32)}` as Hash
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

type Controller = ReturnType<typeof useLiquidityWorkflowController>

type ProbeProps = Readonly<{
	walletClient: Parameters<typeof useLiquidityWorkflowController>[0]['walletClient']
	services: LiveLiquidityServices
	onController: (controller: Controller) => void
	onLockChange: (locked: boolean) => void
	market: LiveMarket
	refresh?: (options?: Readonly<{ background?: boolean }>) => Promise<void>
}>

// One stable component type so re-rendering with a new market object updates the hook instead of remounting it.
function Probe({ walletClient, services, onController, onLockChange, market: probeMarket, refresh = async () => undefined }: ProbeProps) {
	const controller = useLiquidityWorkflowController({
		configuration,
		market: probeMarket,
		balanceState: 'ready',
		account,
		walletClient,
		externallyLocked: false,
		nowSeconds: 1n,
		settings: DEFAULT_TRADE_SETTINGS,
		refresh,
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

// Waits long enough to detect a regression to automatic quoting.
async function settleQuote() {
	await act(async () => {
		await Bun.sleep(QUOTE_SETTLE_MILLISECONDS)
	})
	await flush()
}

describe('liquidity workflow controller state', () => {
	installDomTestLifecycle()

	test('passes the approved local initialization bound to the submission service once', async () => {
		let controller: Controller | undefined
		let sends = 0
		const initialMarket = { ...market, pair: undefined, lpTotalSupply: 0n }
		const baseClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const walletClient = { ...baseClient, waitForTransactionReceipt: async () => ({ status: 'success' as const }) }
		const services: LiveLiquidityServices = {
			submitFreshLiquidity: async (_client, _configuration, _account, quote, guardedWrite) => {
				expect(quote.expectedLiquidity).toBe(10n ** 16n - 1_000n)
				expect(quote.deadline).toEqual({ validityMinutes: DEFAULT_TRADE_SETTINGS.validityMinutes })
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
			expect(controller?.estimate?.operation).toBe('initialize')
			await act(async () => await controller?.submit())
			expect(sends).toBe(1)
			expect(controller?.transaction.state).toBe('confirmed')
		} finally {
			await rendered.cleanup()
		}
	})

	test('retries a failed submission without changing the amount or making background requests', async () => {
		let current: Controller | undefined
		let calls = 0
		const services: LiveLiquidityServices = {
			submitFreshLiquidity: async () => {
				calls++
				throw new Error('RPC unavailable')
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
			expect(current?.estimate?.amount).toBe(10n ** 17n)
			await act(async () => await current?.submit())
			expect(current?.transaction.state).toBe('error')
			await act(async () => await current?.submit())
			expect(current?.amount).toBe('0.1')
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
			expect(rendered.container.querySelector('input[name="probability"]')?.getAttribute('inputmode')).toBe('decimal')
		} finally {
			await rendered.cleanup()
		}
	})

	test('selects Add when initialization refreshes the pool state', async () => {
		const services: LiveLiquidityServices = { submitFreshLiquidity: async () => transactionHash }
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

	test('updates previews immediately as inputs and reserves change without wallet reads', async () => {
		let requests = 0
		const walletClient = createWalletClient({
			account,
			transport: custom({
				request: async () => {
					requests++
					throw new Error('Unexpected read')
				},
			}),
		})
		const services: LiveLiquidityServices = { submitFreshLiquidity: async () => transactionHash }
		let controller: Controller | undefined
		const onController = (next: Controller) => {
			controller = next
		}
		const onLockChange = () => undefined
		const scaledMarket = { ...market, yesReserve: 10n ** 18n, noReserve: 2n * 10n ** 18n, lpTotalSupply: 10n ** 18n }
		const rendered = await renderIntoDocument(controllerProbe(walletClient, services, onController, onLockChange, scaledMarket))
		try {
			await act(() => controller?.updateAmount('0.01'))
			expect(controller?.estimate).toMatchObject({ operation: 'add', amount: 10n ** 16n, liquidity: 5n * 10n ** 15n })
			await act(() => controller?.updateAmount('0.02'))
			expect(controller?.estimate).toMatchObject({ amount: 2n * 10n ** 16n, liquidity: 10n ** 16n })
			await act(() => controller?.selectOperation('remove'))
			await act(() => controller?.updateAmount('0.01'))
			expect(controller?.estimate).toMatchObject({ operation: 'remove', yesOut: 10n ** 16n, noOut: 2n * 10n ** 16n })
			await act(() => render(controllerProbe(walletClient, services, onController, onLockChange, { ...scaledMarket, noReserve: 3n * 10n ** 18n }), rendered.container))
			expect(controller?.estimate).toMatchObject({ yesOut: 10n ** 16n, noOut: 3n * 10n ** 16n })
			await settleQuote()
			expect(requests).toBe(0)
		} finally {
			await rendered.cleanup()
		}
	})

	test('retains the market lock when its tab unmounts during wallet approval', async () => {
		const signature = createDeferred<Hash>()
		const signatureRequested = createDeferred<void>()
		const baseWalletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const walletClient = { ...baseWalletClient, waitForTransactionReceipt: async () => ({ status: 'success' as const }) }
		const services: LiveLiquidityServices = {
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

	test('represents a broadcast with an unknown receipt as one locked uncertain state', async () => {
		const receiptFailure = createDeferred<{ status: 'success' | 'reverted' }>()
		const baseWalletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const walletClient = { ...baseWalletClient, waitForTransactionReceipt: async () => await receiptFailure.promise }
		const services: LiveLiquidityServices = {
			submitFreshLiquidity: async (_client, _configuration, _account, quote, guardedWrite) => {
				// The submission service starts the deadline during its authoritative simulation.
				expect(quote.deadline).toEqual({ validityMinutes: DEFAULT_TRADE_SETTINGS.validityMinutes })
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

	test('refreshes rejected slippage bounds before retry while keeping the amount and error', async () => {
		let controller: Controller | undefined
		let refreshes = 0
		const walletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const submitted: bigint[] = []
		const services: LiveLiquidityServices = {
			submitFreshLiquidity: async (_client, _config, _account, approval) => {
				submitted.push(approval.expectedLiquidity)
				throw new Error('Refreshed estimate no longer satisfies the approved minimum LP tokens')
			},
		}
		const first = { ...market, yesReserve: 10n ** 18n, noReserve: 10n ** 18n, lpTotalSupply: 10n ** 18n }
		const onController = (value: Controller) => {
			controller = value
		}
		const onLockChange = () => undefined
		const refresh = async (options?: Readonly<{ background?: boolean }>) => {
			expect(options).toEqual({ background: true })
			refreshes++
			render(<Probe walletClient={walletClient} services={services} onController={onController} onLockChange={onLockChange} market={{ ...first, lpTotalSupply: 2n * 10n ** 18n }} refresh={refresh} />, rendered.container)
		}
		const rendered = await renderIntoDocument(<Probe walletClient={walletClient} services={services} onController={onController} onLockChange={onLockChange} market={first} refresh={refresh} />)
		try {
			await act(() => controller?.updateAmount('0.01'))
			await act(async () => await controller?.submit())
			expect(refreshes).toBe(1)
			expect(controller?.amount).toBe('0.01')
			expect(controller?.transaction.error).toContain('The price moved past your slippage limit.')
			await act(async () => await controller?.submit())
			expect(submitted).toEqual([10n ** 16n, 2n * 10n ** 16n])
		} finally {
			await rendered.cleanup()
		}
	})

	test('holds the workflow lock during refresh and preserves the rejection when refresh fails', async () => {
		let controller: Controller | undefined
		const refreshing = createDeferred<void>()
		const walletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		const services: LiveLiquidityServices = {
			submitFreshLiquidity: async () => {
				throw new Error('Refreshed estimate no longer satisfies the approved minimum LP tokens')
			},
		}
		const rendered = await renderIntoDocument(
			<Probe
				walletClient={walletClient}
				services={services}
				onController={value => {
					controller = value
				}}
				onLockChange={() => undefined}
				market={market}
				refresh={async () => await refreshing.promise}
			/>,
		)
		try {
			await act(() => controller?.updateAmount('0.01'))
			const submission = controller?.submit()
			await flush()
			expect(controller?.transaction.workflowLocked).toBeTrue()
			await act(() => controller?.updateAmount('0.02'))
			expect(controller?.amount).toBe('0.01')
			refreshing.reject(new Error('Refresh RPC unavailable'))
			await act(async () => await submission)
			expect(controller?.transaction.workflowLocked).toBeFalse()
			expect(controller?.transaction.error).toContain('The price moved past your slippage limit.')
		} finally {
			await rendered.cleanup()
		}
	})

	test('keeps the local preview after a failed validation without requesting background quotes', async () => {
		const walletClient = createWalletClient({ account, transport: custom({ request: async () => undefined }) })
		let submissions = 0
		const services: LiveLiquidityServices = {
			submitFreshLiquidity: async () => {
				submissions++
				throw new Error('Refreshed estimate no longer satisfies the approved minimum LP tokens')
			},
		}
		let controller: Controller | undefined
		const rendered = await renderIntoDocument(
			controllerProbe(
				walletClient,
				services,
				value => {
					controller = value
				},
				() => undefined,
			),
		)
		try {
			await act(() => controller?.updateAmount('0.01'))
			await act(async () => await controller?.submit())
			expect(controller?.transaction.state).toBe('error')
			expect(controller?.transaction.error).toContain('The price moved past your slippage limit.')
			expect(controller?.estimate?.amount).toBe(10n ** 16n)
			await settleQuote()
			expect(submissions).toBe(1)
			await act(async () => await controller?.submit())
			expect(submissions).toBe(2)
		} finally {
			await rendered.cleanup()
		}
	})
})

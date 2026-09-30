import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { createWalletClient, custom } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { LiveLiquidityWorkspace } from '../../features/LiveLiquidityWorkspace.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { smallReserveMarketFixture } from '../support/liveMarketFixture.js'
import type { loadTradingPoolOracle } from '../../protocol/poolOracle.js'

const account = `0x${'11'.repeat(20)}` as const
const market = smallReserveMarketFixture({ pair: undefined, lpTotalSupply: 0n })
const walletClient = createWalletClient({
	account,
	transport: custom({
		request: async () => {
			throw new Error('Unexpected wallet request')
		},
	}),
})
const props = {
	configuration: deploymentConfigurationFixture(),
	market,
	account,
	walletClient,
	balances: undefined,
	balanceState: 'ready' as const,
	balanceError: undefined,
	networkMismatchReason: undefined,
	walletEthAttoEth: 10n ** 18n,
	wallet: { actionLabel: 'Connect wallet', connect: async () => undefined },
	settings: DEFAULT_TRADE_SETTINGS,
	externallyLocked: false,
	nowSeconds: 1n,
	refresh: async () => undefined,
	onKnownReceipt: () => undefined,
	executeWithCurrentWalletContext: async <T,>(_account: unknown, _network: string, _wallet: string, action: () => Promise<T>) => await action(),
	createGuardedWalletWrite: () => async (write: () => Promise<`0x${string}`>) => await write(),
	retryBalances: async () => undefined,
	onWorkflowLockChange: () => undefined,
}
function oracle(isPriceValid: boolean, pendingReportId = 0n): Awaited<ReturnType<typeof loadTradingPoolOracle>> {
	return {
		managerAddress: account,
		details: {
			managerAddress: account,
			openOracleAddress: account,
			isPriceValid,
			lastPrice: 10n ** 18n,
			lastSettlementTimestamp: 1n,
			priceValidUntilTimestamp: 100n,
			pendingReportId,
			pendingOperationSlotId: 0n,
			pendingSettlementOperationIds: [],
			pendingSettlementQueueCapacity: 1n,
			queuedOperationCostAttoEth: 0n,
			requestPriceCostAttoEth: 101n,
			callbackStateHash: undefined,
			exactToken1Report: undefined,
			pendingOperation: undefined,
			token1: undefined,
			token2: undefined,
		},
	}
}
function button(container: HTMLElement, label: string) {
	const result = [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.includes(label))
	if (result === undefined) throw new Error(`Missing button: ${label}`)
	return result
}
async function flush() {
	await act(async () => {
		await Promise.resolve()
		await Promise.resolve()
	})
}

describe('Trading pool oracle recovery', () => {
	installDomTestLifecycle()
	test('blocks unknown and stale prices, offers a request, and notices settlement on refresh', async () => {
		const first = createDeferred<Awaited<ReturnType<typeof loadTradingPoolOracle>>>()
		let next = first.promise
		const loadOracle = async () => await next
		const rendered = await renderIntoDocument(<LiveLiquidityWorkspace {...props} loadOracle={loadOracle} />)
		try {
			expect(button(rendered.container, 'Request price update').disabled).toBe(true)
			expect(button(rendered.container, 'Initialize pool').disabled).toBe(true)
			await act(async () => {
				first.resolve(oracle(false))
				await first.promise
			})
			await flush()
			expect(rendered.container.textContent).toContain('A fresh REP/ETH oracle price is required')
			expect(button(rendered.container, 'Request price update').disabled).toBe(false)
			next = Promise.resolve(oracle(false, 7n))
			await act(() => button(rendered.container, 'Refresh oracle price').click())
			await flush()
			expect(rendered.container.textContent).toContain('after the report settles')
			expect(button(rendered.container, 'Request price update').disabled).toBe(true)
			next = Promise.resolve(oracle(true))
			await act(() => button(rendered.container, 'Refresh oracle price').click())
			await flush()
			expect(rendered.container.textContent).toContain('The oracle price is already current')
			expect(button(rendered.container, 'Request price update').disabled).toBe(true)
			await act(() => render(<LiveLiquidityWorkspace {...props} nowSeconds={101n} loadOracle={loadOracle} />, rendered.container))
			await flush()
			expect(rendered.container.textContent).toContain('A fresh REP/ETH oracle price is required')
		} finally {
			await rendered.cleanup()
		}
	})

	test('does not replace an in-flight oracle read on every clock refresh', async () => {
		const deferred = createDeferred<Awaited<ReturnType<typeof loadTradingPoolOracle>>>()
		let reads = 0
		const loadOracle = async () => {
			reads += 1
			return await deferred.promise
		}
		const rendered = await renderIntoDocument(<LiveLiquidityWorkspace {...props} loadOracle={loadOracle} />)
		try {
			await act(() => render(<LiveLiquidityWorkspace {...props} nowSeconds={20n} loadOracle={loadOracle} />, rendered.container))
			await flush()
			expect(reads).toBe(1)
			await act(async () => {
				deferred.resolve(oracle(false))
				await deferred.promise
			})
			await flush()
			expect(reads).toBe(1)
		} finally {
			await rendered.cleanup()
		}
	})

	test('shows a price-request preparation failure above the open review without sending', async () => {
		const backend = createFakeBackend({ accountAddress: account })
		const restore = installActiveEnvironmentForTesting({
			...backend,
			createReadClient: () => {
				throw new Error('Oracle RPC unavailable')
			},
		})
		const rendered = await renderIntoDocument(<LiveLiquidityWorkspace {...props} loadOracle={async () => oracle(false)} />)
		try {
			await flush()
			await act(() => button(rendered.container, 'Request price update').click())
			const input = document.querySelector('[role="dialog"] input')
			if (!(input instanceof HTMLInputElement)) throw new Error('Missing oracle price input')
			await act(() => {
				input.value = '3'
				input.dispatchEvent(new Event('input', { bubbles: true }))
			})
			await act(async () => {
				await Bun.sleep(450)
			})
			await flush()
			const status = document.querySelector('.global-transaction-dialog')
			expect(status?.textContent).toContain('Oracle RPC unavailable')
			expect(status?.getAttribute('role')).toBe('dialog')
		} finally {
			await rendered.cleanup()
			restore()
		}
	})

	test('fails closed on read failure and does not reuse another pool’s oracle answer', async () => {
		const late = createDeferred<Awaited<ReturnType<typeof loadTradingPoolOracle>>>()
		const loadOracle = async () => await late.promise
		const rendered = await renderIntoDocument(<LiveLiquidityWorkspace {...props} loadOracle={loadOracle} />)
		try {
			await act(() =>
				render(
					<LiveLiquidityWorkspace
						{...props}
						market={{ ...market, pool: account }}
						loadOracle={async () => {
							throw new Error('RPC unavailable')
						}}
					/>,
					rendered.container,
				),
			)
			await flush()
			await act(async () => {
				late.resolve(oracle(true))
				await late.promise
			})
			await flush()
			expect(rendered.container.textContent).toContain('Oracle price unavailable')
			expect(button(rendered.container, 'Request price update').disabled).toBe(true)
			expect(button(rendered.container, 'Initialize pool').disabled).toBe(true)
		} finally {
			await rendered.cleanup()
		}
	})
})

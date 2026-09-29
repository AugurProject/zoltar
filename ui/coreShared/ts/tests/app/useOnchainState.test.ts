import { createDeferred } from '../testUtils/deferred.js'
/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { loadWalletState } from '../../app/hooks/loadWalletState.js'
import type { UseOnchainStateDependencies } from '../../app/hooks/useOnchainState.js'
import { useOnchainState } from '../../app/hooks/useOnchainState.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../../lib/activeEnvironment.js'
import { createLoadController } from '../../lib/loadState.js'
import type { AccountState } from '../../types/app.js'
import { createFakeBackend } from '../testUtils/fakeBackend.js'
import { fireEvent, within } from '../testUtils/queries'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

const fakeOnchainStateDependencies: UseOnchainStateDependencies = {
	getDeploymentSteps: () => [],
	getWethAddress: () => '0x0000000000000000000000000000000000000ee1' as const,
	loadDeploymentStatusOracleSnapshot: async () => ({ applicationDeploymentComplete: false, deploymentStatuses: [] }),
	loadErc20Balance: async () => 0n,
}

const connectedAccountState = (overrides: Partial<AccountState> = {}): AccountState => ({
	address: zeroAddress,
	chainId: undefined,
	ethBalanceAttoEth: undefined,
	wethBalanceAttoEth: undefined,
	...overrides,
})

type WalletLoadOptions = {
	fallbackChainId?: string
	isCurrent?: () => boolean
	track?: <TResult>(work: () => Promise<TResult>) => Promise<TResult>
}

/** Starts a connected-wallet load whose chain ID and balance reads resolve only when the test settles them. */
function startWalletLoad(initialAccountState: AccountState, { fallbackChainId, isCurrent = () => true, track = async work => await work() }: WalletLoadOptions = {}) {
	const chainId = createDeferred<string>()
	const ethBalance = createDeferred<bigint>()
	const wethBalance = createDeferred<bigint>()
	const trackedLoads: Promise<unknown>[] = []
	const observed: { accountState: AccountState; errorMessage: string | undefined; setAccountStateCalls: number } = { accountState: initialAccountState, errorMessage: undefined, setAccountStateCalls: 0 }
	const loadPromise = loadWalletState({
		chainIdPromise: chainId.promise,
		connectedAddress: zeroAddress,
		ethBalanceAttoEthPromise: ethBalance.promise,
		...(fallbackChainId === undefined ? {} : { fallbackChainId }),
		getAccountState: () => observed.accountState,
		isCurrent,
		setAccountState: state => {
			observed.setAccountStateCalls += 1
			observed.accountState = state
		},
		setErrorMessage: message => {
			observed.errorMessage = message
		},
		trackLoad: async work => {
			const trackedLoad = track(work)
			trackedLoads.push(trackedLoad)
			return await trackedLoad
		},
		wethBalanceAttoEthPromise: wethBalance.promise,
	})
	const trackedLoad = async (index: number) => await (trackedLoads[index] ?? Promise.reject(new Error(`Expected tracked wallet load ${index.toString()}`)))
	return { chainId, ethBalance, wethBalance, trackedLoads, trackedLoad, observed, loadPromise }
}

void describe('loadWalletState', () => {
	void test('resolves after scheduling wallet loads and applies updates as each load completes', async () => {
		let resolved = false
		const load = startWalletLoad(connectedAccountState())
		const loadPromise = load.loadPromise.then(() => {
			resolved = true
		})

		expect(resolved).toBe(false)
		await loadPromise
		expect(resolved).toBe(true)

		load.chainId.resolve('0x1')
		await load.trackedLoad(0)
		expect(load.observed.accountState.chainId).toBe('0x1')

		load.ethBalance.resolve(123n)
		await load.trackedLoad(1)
		expect(load.observed.accountState.ethBalanceAttoEth).toBe(123n)

		load.wethBalance.resolve(456n)
		await load.trackedLoad(2)
		expect(load.observed.errorMessage).toBe(undefined)
		expect(load.observed.accountState.address).toBe(zeroAddress)
		expect(load.observed.accountState.chainId).toBe('0x1')
		expect(load.observed.accountState.ethBalanceAttoEth).toBe(123n)
		expect(load.observed.accountState.wethBalanceAttoEth).toBe(456n)
	})

	void test('keeps tracked loading active until each scheduled wallet load settles', async () => {
		const controller = createLoadController()
		const load = startWalletLoad(connectedAccountState(), { track: async work => await controller.track(work) })
		await load.loadPromise

		expect(controller.isLoading.value).toBe(true)

		load.chainId.resolve('0x1')
		await load.trackedLoad(0)
		expect(controller.isLoading.value).toBe(true)

		load.ethBalance.resolve(123n)
		await load.trackedLoad(1)
		expect(controller.isLoading.value).toBe(true)

		load.wethBalance.resolve(456n)
		await load.trackedLoad(2)
		expect(controller.isLoading.value).toBe(false)
		expect(load.observed.accountState.chainId).toBe('0x1')
		expect(load.observed.accountState.ethBalanceAttoEth).toBe(123n)
		expect(load.observed.accountState.wethBalanceAttoEth).toBe(456n)
	})

	void test('does not mutate balances when no wallet is connected', async () => {
		let accountState: AccountState = {
			address: undefined,
			chainId: '0x1',
			ethBalanceAttoEth: 123n,
			wethBalanceAttoEth: 456n,
		}

		await loadWalletState({
			chainIdPromise: undefined,
			connectedAddress: undefined,
			ethBalanceAttoEthPromise: undefined,
			getAccountState: () => accountState,
			isCurrent: () => true,
			setAccountState: state => {
				accountState = state
			},
			setErrorMessage: () => undefined,
			trackLoad: async work => await work(),
			wethBalanceAttoEthPromise: undefined,
		})

		expect(accountState.ethBalanceAttoEth).toBe(123n)
		expect(accountState.wethBalanceAttoEth).toBe(456n)
	})

	void test.each([
		{ name: 'refresh callbacks are stale', settleEthBalance: (ethBalance: ReturnType<typeof createDeferred<bigint>>) => ethBalance.resolve(111n) },
		{ name: 'wallet state callbacks are stale and a balance read fails', settleEthBalance: (ethBalance: ReturnType<typeof createDeferred<bigint>>) => ethBalance.reject(new Error('eth rpc failed')) },
	])('skips state and error updates when $name', async ({ settleEthBalance }) => {
		let isCurrentCalls = 0
		const staleAccountState = connectedAccountState({ chainId: '0xfeed', ethBalanceAttoEth: 123n, wethBalanceAttoEth: 456n })
		const load = startWalletLoad(staleAccountState, {
			isCurrent: () => {
				isCurrentCalls += 1
				return false
			},
		})

		load.chainId.resolve('0x123')
		settleEthBalance(load.ethBalance)
		load.wethBalance.resolve(222n)
		await Promise.all(load.trackedLoads)
		await load.loadPromise

		expect(isCurrentCalls).toBe(3)
		expect(load.observed.setAccountStateCalls).toBe(0)
		expect(load.observed.errorMessage).toBeUndefined()
		expect(load.observed.accountState).toMatchObject({
			address: zeroAddress,
			chainId: '0xfeed',
			ethBalanceAttoEth: 123n,
			wethBalanceAttoEth: 456n,
		})
	})

	void test('uses fallback chain ID if chain-id refresh fails', async () => {
		const load = startWalletLoad(connectedAccountState({ chainId: '0xfeed' }), { fallbackChainId: '0x123' })

		load.chainId.reject(new Error('chain id RPC failed'))
		await load.trackedLoads[0]
		load.ethBalance.resolve(500n)
		load.wethBalance.resolve(600n)
		await Promise.all(load.trackedLoads.slice(1))

		await load.loadPromise

		expect(load.observed.errorMessage).toBeUndefined()
		expect(load.observed.accountState.chainId).toBe('0x123')
		expect(load.observed.accountState.ethBalanceAttoEth).toBe(500n)
		expect(load.observed.accountState.wethBalanceAttoEth).toBe(600n)
	})

	void test('rethrows unsupported chain-id refresh failures', async () => {
		const load = startWalletLoad(connectedAccountState(), {
			track: async work => await work().catch(error => error as never),
		})
		await load.loadPromise

		load.chainId.reject(7)
		expect(await load.trackedLoad(0)).toBe(7)

		load.ethBalance.resolve(500n)
		load.wethBalance.resolve(600n)
		await load.trackedLoad(1)
		await load.trackedLoad(2)

		expect(load.observed.accountState.chainId).toBeUndefined()
		expect(load.observed.accountState.ethBalanceAttoEth).toBe(500n)
		expect(load.observed.accountState.wethBalanceAttoEth).toBe(600n)
	})

	void test.each([
		{ failingBalance: 'WETH', ethBalanceAttoEth: 500n, wethBalanceAttoEth: undefined },
		{ failingBalance: 'ETH', ethBalanceAttoEth: undefined, wethBalanceAttoEth: 777n },
	] as const)('maps $failingBalance balance load failures into refresh errors', async ({ failingBalance, ethBalanceAttoEth, wethBalanceAttoEth }) => {
		const load = startWalletLoad(connectedAccountState())
		const settle = (deferred: ReturnType<typeof createDeferred<bigint>>, value: bigint | undefined, reason: string) => (value === undefined ? deferred.reject(new Error(reason)) : deferred.resolve(value))

		load.chainId.resolve('0x123')
		await load.trackedLoad(0)
		settle(load.ethBalance, ethBalanceAttoEth, 'eth rpc failed')
		await load.trackedLoad(1)
		settle(load.wethBalance, wethBalanceAttoEth, 'weth rpc failed')
		await load.trackedLoad(2)

		await load.loadPromise

		expect(load.observed.errorMessage ?? '').toBe(`Failed to refresh wallet balances. Reason: ${failingBalance.toLowerCase()} rpc failed`)
		expect(load.observed.accountState.chainId).toBe('0x123')
		expect(load.observed.accountState.ethBalanceAttoEth).toBe(ethBalanceAttoEth)
		expect(load.observed.accountState.wethBalanceAttoEth).toBe(wethBalanceAttoEth)
	})
})

void describe('useOnchainState', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	function OnchainStateHarness() {
		const { connectWallet, errorMessage } = useOnchainState({}, fakeOnchainStateDependencies)

		return h('div', {}, [
			h(
				'button',
				{
					onClick: () => {
						void connectWallet()
					},
					type: 'button',
				},
				'Connect wallet',
			),
			h('output', { 'aria-label': 'Error message' }, errorMessage ?? ''),
		])
	}

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			resetActiveEnvironmentForTesting()
		},
	})

	void test('surfaces an explicit error when connect wallet is clicked without a wallet installed', async () => {
		installActiveEnvironmentForTesting({
			...createFakeBackend({ hasWallet: false }),
			isBootstrapped: false,
		})

		const renderedComponent = await renderIntoDocument(h(OnchainStateHarness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const connectButton = documentQueries.getByRole('button', { name: 'Connect wallet' })

		await act(() => {
			fireEvent.click(connectButton)
		})

		expect(documentQueries.getByLabelText('Error message').textContent).toBe('No wallet detected. Install or enable a wallet to continue.')
	})
})

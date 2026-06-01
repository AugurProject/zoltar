/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'
import { loadWalletState, useOnchainState } from '../hooks/useOnchainState.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { createLoadController } from '../lib/loadState.js'
import type { AccountState } from '../types/app.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

void describe('loadWalletState', () => {
	void test('resolves after scheduling wallet loads and applies updates as each load completes', async () => {
		const chainIdDeferred = createDeferred<string>()
		const ethBalanceDeferred = createDeferred<bigint>()
		const wethBalanceDeferred = createDeferred<bigint>()
		const scheduledLoads: Promise<unknown>[] = []
		let accountState: AccountState = {
			address: zeroAddress,
			chainId: undefined,
			ethBalance: undefined,
			wethBalance: undefined,
		}
		let errorMessage: string | undefined = undefined
		let resolved = false
		const loadPromise = loadWalletState({
			chainIdPromise: chainIdDeferred.promise,
			connectedAddress: zeroAddress,
			ethBalancePromise: ethBalanceDeferred.promise,
			getAccountState: () => accountState,
			isCurrent: () => true,
			setAccountState: state => {
				accountState = state
			},
			setErrorMessage: message => {
				errorMessage = message
			},
			trackLoad: async work => {
				const scheduledLoad = work()
				scheduledLoads.push(scheduledLoad)
				return await scheduledLoad
			},
			wethBalancePromise: wethBalanceDeferred.promise,
		}).then(() => {
			resolved = true
		})

		expect(resolved).toBe(false)
		await loadPromise
		expect(resolved).toBe(true)

		chainIdDeferred.resolve('0x1')
		await (scheduledLoads[0] ?? Promise.reject(new Error('Expected chain ID load promise')))
		expect(accountState.chainId).toBe('0x1')

		ethBalanceDeferred.resolve(123n)
		await (scheduledLoads[1] ?? Promise.reject(new Error('Expected ETH balance load promise')))
		expect(accountState.ethBalance).toBe(123n)

		wethBalanceDeferred.resolve(456n)
		await (scheduledLoads[2] ?? Promise.reject(new Error('Expected WETH balance load promise')))
		expect(errorMessage).toBe(undefined)
		expect(accountState.address).toBe(zeroAddress)
		expect(accountState.chainId).toBe('0x1')
		expect(accountState.ethBalance).toBe(123n)
		expect(accountState.wethBalance).toBe(456n)
	})

	void test('keeps tracked loading active until each scheduled wallet load settles', async () => {
		const chainIdDeferred = createDeferred<string>()
		const ethBalanceDeferred = createDeferred<bigint>()
		const wethBalanceDeferred = createDeferred<bigint>()
		const controller = createLoadController()
		const trackedLoads: Promise<unknown>[] = []
		let accountState: AccountState = {
			address: zeroAddress,
			chainId: undefined,
			ethBalance: undefined,
			wethBalance: undefined,
		}

		await loadWalletState({
			chainIdPromise: chainIdDeferred.promise,
			connectedAddress: zeroAddress,
			ethBalancePromise: ethBalanceDeferred.promise,
			getAccountState: () => accountState,
			isCurrent: () => true,
			setAccountState: state => {
				accountState = state
			},
			setErrorMessage: () => undefined,
			trackLoad: async work => {
				const trackedLoad = controller.track(work)
				trackedLoads.push(trackedLoad)
				return await trackedLoad
			},
			wethBalancePromise: wethBalanceDeferred.promise,
		})

		expect(controller.isLoading.value).toBe(true)

		chainIdDeferred.resolve('0x1')
		await (trackedLoads[0] ?? Promise.reject(new Error('Expected tracked chain ID load promise')))
		expect(controller.isLoading.value).toBe(true)

		ethBalanceDeferred.resolve(123n)
		await (trackedLoads[1] ?? Promise.reject(new Error('Expected tracked ETH balance load promise')))
		expect(controller.isLoading.value).toBe(true)

		wethBalanceDeferred.resolve(456n)
		await (trackedLoads[2] ?? Promise.reject(new Error('Expected tracked WETH balance load promise')))
		expect(controller.isLoading.value).toBe(false)
		expect(accountState.chainId).toBe('0x1')
		expect(accountState.ethBalance).toBe(123n)
		expect(accountState.wethBalance).toBe(456n)
	})

	void test('does not mutate balances when no wallet is connected', async () => {
		let accountState: AccountState = {
			address: undefined,
			chainId: '0x1',
			ethBalance: 123n,
			wethBalance: 456n,
		}

		await loadWalletState({
			chainIdPromise: undefined,
			connectedAddress: undefined,
			ethBalancePromise: undefined,
			getAccountState: () => accountState,
			isCurrent: () => true,
			setAccountState: state => {
				accountState = state
			},
			setErrorMessage: () => undefined,
			trackLoad: async work => await work(),
			wethBalancePromise: undefined,
		})

		expect(accountState.ethBalance).toBe(123n)
		expect(accountState.wethBalance).toBe(456n)
	})

	void test('skips state updates when refresh callbacks are stale', async () => {
		const chainIdDeferred = createDeferred<string>()
		const ethBalanceDeferred = createDeferred<bigint>()
		const wethBalanceDeferred = createDeferred<bigint>()
		const trackedLoads: Promise<unknown>[] = []
		let accountState: AccountState = {
			address: zeroAddress,
			chainId: '0xfeed',
			ethBalance: 123n,
			wethBalance: 456n,
		}
		let errorMessage: string | undefined = undefined
		let setAccountStateCalls = 0
		let isCurrentCalls = 0
		const isCurrent = () => {
			isCurrentCalls += 1
			return false
		}

		const loadPromise = loadWalletState({
			chainIdPromise: chainIdDeferred.promise,
			connectedAddress: zeroAddress,
			ethBalancePromise: ethBalanceDeferred.promise,
			getAccountState: () => accountState,
			isCurrent,
			setAccountState: state => {
				setAccountStateCalls += 1
				accountState = state
			},
			setErrorMessage: message => {
				errorMessage = message
			},
			trackLoad: async work => {
				const trackedLoad = work()
				trackedLoads.push(trackedLoad)
				return await trackedLoad
			},
			wethBalancePromise: wethBalanceDeferred.promise,
		})

		chainIdDeferred.resolve('0x123')
		ethBalanceDeferred.resolve(111n)
		wethBalanceDeferred.resolve(222n)
		await Promise.all(trackedLoads)
		await loadPromise

		expect(isCurrentCalls).toBe(3)
		expect(setAccountStateCalls).toBe(0)
		expect(errorMessage).toBeUndefined()
		expect(accountState).toMatchObject({
			address: zeroAddress,
			chainId: '0xfeed',
			ethBalance: 123n,
			wethBalance: 456n,
		})
	})

	void test('skips error updates when wallet state callbacks are stale', async () => {
		const chainIdDeferred = createDeferred<string>()
		const ethBalanceDeferred = createDeferred<bigint>()
		const wethBalanceDeferred = createDeferred<bigint>()
		const trackedLoads: Promise<unknown>[] = []
		let accountState: AccountState = {
			address: zeroAddress,
			chainId: '0xfeed',
			ethBalance: 123n,
			wethBalance: 456n,
		}
		let errorMessage: string | undefined = undefined
		let isCurrentCalls = 0
		const isCurrent = () => {
			isCurrentCalls += 1
			return false
		}

		const loadPromise = loadWalletState({
			chainIdPromise: chainIdDeferred.promise,
			connectedAddress: zeroAddress,
			ethBalancePromise: ethBalanceDeferred.promise,
			getAccountState: () => accountState,
			isCurrent,
			setAccountState: state => {
				accountState = state
			},
			setErrorMessage: message => {
				errorMessage = message
			},
			trackLoad: async work => {
				const trackedLoad = work()
				trackedLoads.push(trackedLoad)
				return await trackedLoad
			},
			wethBalancePromise: wethBalanceDeferred.promise,
		})

		chainIdDeferred.resolve('0x123')
		ethBalanceDeferred.reject(new Error('eth rpc failed'))
		wethBalanceDeferred.resolve(222n)

		await Promise.all(trackedLoads)
		await loadPromise

		expect(isCurrentCalls).toBe(3)
		expect(errorMessage).toBeUndefined()
		expect(accountState).toMatchObject({
			address: zeroAddress,
			chainId: '0xfeed',
			ethBalance: 123n,
			wethBalance: 456n,
		})
	})

	void test('uses fallback chain ID if chain-id refresh fails', async () => {
		const chainIdDeferred = createDeferred<string>()
		const ethBalanceDeferred = createDeferred<bigint>()
		const wethBalanceDeferred = createDeferred<bigint>()
		const trackedLoads: Promise<unknown>[] = []
		let accountState: AccountState = {
			address: zeroAddress,
			chainId: '0xfeed',
			ethBalance: undefined,
			wethBalance: undefined,
		}
		let errorMessage: string | undefined = undefined
		const loadPromise = loadWalletState({
			chainIdPromise: chainIdDeferred.promise,
			connectedAddress: zeroAddress,
			ethBalancePromise: ethBalanceDeferred.promise,
			fallbackChainId: '0x123',
			getAccountState: () => accountState,
			isCurrent: () => true,
			setAccountState: state => {
				accountState = state
			},
			setErrorMessage: message => {
				errorMessage = message
			},
			trackLoad: async work => {
				const trackedLoad = work()
				trackedLoads.push(trackedLoad)
				return await trackedLoad
			},
			wethBalancePromise: wethBalanceDeferred.promise,
		})

		chainIdDeferred.reject(new Error('chain id RPC failed'))
		await trackedLoads[0]
		ethBalanceDeferred.resolve(500n)
		wethBalanceDeferred.resolve(600n)
		await Promise.all(trackedLoads.slice(1))

		await loadPromise

		expect(errorMessage).toBeUndefined()
		expect(accountState.chainId).toBe('0x123')
		expect(accountState.ethBalance).toBe(500n)
		expect(accountState.wethBalance).toBe(600n)
	})

	void test('maps ETH balance load failures into refresh errors', async () => {
		const chainIdDeferred = createDeferred<string>()
		const ethBalanceDeferred = createDeferred<bigint>()
		const wethBalanceDeferred = createDeferred<bigint>()
		const trackedLoads: Promise<unknown>[] = []
		let accountState: AccountState = {
			address: zeroAddress,
			chainId: undefined,
			ethBalance: undefined,
			wethBalance: undefined,
		}
		let errorMessage: string | undefined = undefined
		const loadPromise = loadWalletState({
			chainIdPromise: chainIdDeferred.promise,
			connectedAddress: zeroAddress,
			ethBalancePromise: ethBalanceDeferred.promise,
			getAccountState: () => accountState,
			isCurrent: () => true,
			setAccountState: state => {
				accountState = state
			},
			setErrorMessage: message => {
				errorMessage = message
			},
			trackLoad: async work => {
				const trackedLoad = work()
				trackedLoads.push(trackedLoad)
				return await trackedLoad
			},
			wethBalancePromise: wethBalanceDeferred.promise,
		})

		chainIdDeferred.resolve('0x123')
		await trackedLoads[0]
		ethBalanceDeferred.reject(new Error('eth rpc failed'))
		await trackedLoads[1]
		wethBalanceDeferred.resolve(777n)
		await trackedLoads[2]

		await loadPromise

		expect(errorMessage).toBe('Failed to refresh wallet balances. Reason: eth rpc failed')
		expect(accountState.chainId).toBe('0x123')
		expect(accountState.ethBalance).toBeUndefined()
		expect(accountState.wethBalance).toBe(777n)
	})

	void test('maps WETH balance load failures into refresh errors', async () => {
		const chainIdDeferred = createDeferred<string>()
		const ethBalanceDeferred = createDeferred<bigint>()
		const wethBalanceDeferred = createDeferred<bigint>()
		const trackedLoads: Promise<unknown>[] = []
		let accountState: AccountState = {
			address: zeroAddress,
			chainId: undefined,
			ethBalance: undefined,
			wethBalance: undefined,
		}
		let errorMessage: string | undefined = undefined
		const loadPromise = loadWalletState({
			chainIdPromise: chainIdDeferred.promise,
			connectedAddress: zeroAddress,
			ethBalancePromise: ethBalanceDeferred.promise,
			getAccountState: () => accountState,
			isCurrent: () => true,
			setAccountState: state => {
				accountState = state
			},
			setErrorMessage: message => {
				errorMessage = message
			},
			trackLoad: async work => {
				const trackedLoad = work()
				trackedLoads.push(trackedLoad)
				return await trackedLoad
			},
			wethBalancePromise: wethBalanceDeferred.promise,
		})

		chainIdDeferred.resolve('0x123')
		await trackedLoads[0]
		ethBalanceDeferred.resolve(888n)
		await trackedLoads[1]
		wethBalanceDeferred.reject(new Error('weth rpc failed'))
		await trackedLoads[2]

		await loadPromise

		expect(errorMessage).toBe('Failed to refresh wallet balances. Reason: weth rpc failed')
		expect(accountState.chainId).toBe('0x123')
		expect(accountState.ethBalance).toBe(888n)
		expect(accountState.wethBalance).toBeUndefined()
	})
})

void describe('useOnchainState', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	function OnchainStateHarness() {
		const { connectWallet, errorMessage } = useOnchainState()

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

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		resetActiveEnvironmentForTesting()
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

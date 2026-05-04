/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { loadWalletState } from '../hooks/useOnchainState.js'
import { createLoadController } from '../lib/loadState.js'
import type { AccountState } from '../types/app.js'

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

async function flushAsyncUpdates() {
	await Promise.resolve()
	await Promise.resolve()
}

void describe('loadWalletState', () => {
	void test('resolves after scheduling wallet loads and applies updates as each load completes', async () => {
		const chainIdDeferred = createDeferred<string>()
		const ethBalanceDeferred = createDeferred<bigint>()
		const wethBalanceDeferred = createDeferred<bigint>()
		let accountState: AccountState = {
			address: zeroAddress,
			chainId: undefined,
			walletChainId: undefined,
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
			trackLoad: async work => await work(),
			wethBalancePromise: wethBalanceDeferred.promise,
		}).then(() => {
			resolved = true
		})

		expect(resolved).toBe(false)
		await Promise.resolve()
		expect(resolved).toBe(true)

		chainIdDeferred.resolve('0x1')
		await Promise.resolve()
		expect(accountState.chainId).toBe('0x1')
		expect(accountState.walletChainId).toBe('0x1')

		ethBalanceDeferred.resolve(123n)
		await Promise.resolve()
		expect(accountState.ethBalance).toBe(123n)

		wethBalanceDeferred.resolve(456n)
		await flushAsyncUpdates()

		await loadPromise
		expect(errorMessage).toBe(undefined)
		expect(accountState.address).toBe(zeroAddress)
		expect(accountState.chainId).toBe('0x1')
		expect(accountState.walletChainId).toBe('0x1')
		expect(accountState.ethBalance).toBe(123n)
		expect(accountState.wethBalance).toBe(456n)
	})

	void test('keeps tracked loading active until each scheduled wallet load settles', async () => {
		const chainIdDeferred = createDeferred<string>()
		const ethBalanceDeferred = createDeferred<bigint>()
		const wethBalanceDeferred = createDeferred<bigint>()
		const controller = createLoadController()
		let accountState: AccountState = {
			address: zeroAddress,
			chainId: undefined,
			walletChainId: undefined,
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
			trackLoad: controller.track,
			wethBalancePromise: wethBalanceDeferred.promise,
		})

		expect(controller.isLoading.value).toBe(true)

		chainIdDeferred.resolve('0x1')
		await Promise.resolve()
		expect(controller.isLoading.value).toBe(true)

		ethBalanceDeferred.resolve(123n)
		await Promise.resolve()
		expect(controller.isLoading.value).toBe(true)

		wethBalanceDeferred.resolve(456n)
		await flushAsyncUpdates()
		expect(controller.isLoading.value).toBe(false)
		expect(accountState.chainId).toBe('0x1')
		expect(accountState.walletChainId).toBe('0x1')
		expect(accountState.ethBalance).toBe(123n)
		expect(accountState.wethBalance).toBe(456n)
	})
})

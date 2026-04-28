/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { loadWalletState } from '../hooks/useOnchainState.js'
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

void describe('loadWalletState', () => {
	void test('waits for the balance lookup before resolving', async () => {
		const chainIdDeferred = createDeferred<string>()
		const ethBalanceDeferred = createDeferred<bigint>()
		const wethBalanceDeferred = createDeferred<bigint>()
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
			wethBalancePromise: wethBalanceDeferred.promise,
		}).then(() => {
			resolved = true
		})

		await Promise.resolve()
		expect(resolved).toBe(false)

		chainIdDeferred.resolve('0x1')
		await Promise.resolve()
		expect(resolved).toBe(false)
		expect(accountState.chainId).toBe('0x1')

		ethBalanceDeferred.resolve(123n)
		await Promise.resolve()
		expect(resolved).toBe(false)

		wethBalanceDeferred.resolve(456n)
		await loadPromise

		expect(resolved).toBe(true)
		expect(errorMessage).toBe(undefined)
		expect(accountState.address).toBe(zeroAddress)
		expect(accountState.chainId).toBe('0x1')
		expect(accountState.ethBalance).toBe(123n)
		expect(accountState.wethBalance).toBe(456n)
	})
})

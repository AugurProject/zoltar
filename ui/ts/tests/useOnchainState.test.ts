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
		const balanceDeferred = createDeferred<bigint>()
		let accountState: AccountState = {
			address: zeroAddress,
			chainId: undefined,
			ethBalance: undefined,
		}
		let errorMessage: string | undefined = undefined
		let resolved = false
		const loadPromise = loadWalletState({
			balancePromise: balanceDeferred.promise,
			chainIdPromise: chainIdDeferred.promise,
			connectedAddress: zeroAddress,
			getAccountState: () => accountState,
			isCurrent: () => true,
			setAccountState: state => {
				accountState = state
			},
			setErrorMessage: message => {
				errorMessage = message
			},
		}).then(() => {
			resolved = true
		})

		await Promise.resolve()
		expect(resolved).toBe(false)

		chainIdDeferred.resolve('0x1')
		await Promise.resolve()
		expect(resolved).toBe(false)
		expect(accountState.chainId).toBe('0x1')

		balanceDeferred.resolve(123n)
		await loadPromise

		expect(resolved).toBe(true)
		expect(errorMessage).toBe(undefined)
		expect(accountState.address).toBe(zeroAddress)
		expect(accountState.chainId).toBe('0x1')
		expect(accountState.ethBalance).toBe(123n)
	})
})

/// <reference types="bun-types" />

import { describe, expect, mock, test } from 'bun:test'
import { createSupportedNetworkChangeCoordinator } from '../../app/lib/supportedNetworkChange.js'

function createDeferred() {
	let resolve: () => void = () => undefined
	const promise = new Promise<void>(promiseResolve => {
		resolve = promiseResolve
	})
	return { promise, resolve }
}

describe('supported network change coordination', () => {
	test('defers environment replacement until the active write action finishes', async () => {
		let inFlightCount = 1
		const replaceEnvironment = mock(async (_canCommit: () => boolean) => true)
		const coordinator = createSupportedNetworkChangeCoordinator({
			getInFlightCount: () => inFlightCount,
			replaceEnvironment,
		})

		await coordinator.handleSupportedNetworkChange()
		expect(replaceEnvironment).not.toHaveBeenCalled()

		inFlightCount = 0
		await coordinator.handleTransactionFinished()
		expect(replaceEnvironment).toHaveBeenCalledTimes(1)
	})

	test('coalesces supported chain changes while a write action is active', async () => {
		let inFlightCount = 1
		const replaceEnvironment = mock(async (_canCommit: () => boolean) => true)
		const coordinator = createSupportedNetworkChangeCoordinator({
			getInFlightCount: () => inFlightCount,
			replaceEnvironment,
		})

		await coordinator.handleSupportedNetworkChange()
		await coordinator.handleSupportedNetworkChange()
		inFlightCount = 0
		await coordinator.handleTransactionFinished()

		expect(replaceEnvironment).toHaveBeenCalledTimes(1)
	})

	test('retries when a write starts during asynchronous network discovery', async () => {
		let inFlightCount = 0
		const discovery = createDeferred()
		const replaceEnvironment = mock(async (canCommit: () => boolean) => {
			await discovery.promise
			return canCommit()
		})
		const coordinator = createSupportedNetworkChangeCoordinator({
			getInFlightCount: () => inFlightCount,
			replaceEnvironment,
		})

		const replacement = coordinator.handleSupportedNetworkChange()
		inFlightCount = 1
		discovery.resolve()
		await replacement
		expect(replaceEnvironment).toHaveBeenCalledTimes(1)

		inFlightCount = 0
		await coordinator.handleTransactionFinished()
		expect(replaceEnvironment).toHaveBeenCalledTimes(2)
	})

	test('retries when the write finishes before a rejected replacement resolves', async () => {
		let inFlightCount = 0
		const discovery = createDeferred()
		const rejectedReplacement = createDeferred()
		let replacementAttempt = 0
		const replaceEnvironment = mock(async (canCommit: () => boolean) => {
			replacementAttempt += 1
			if (replacementAttempt > 1) return canCommit()
			await discovery.promise
			const committed = canCommit()
			await rejectedReplacement.promise
			return committed
		})
		const coordinator = createSupportedNetworkChangeCoordinator({
			getInFlightCount: () => inFlightCount,
			replaceEnvironment,
		})

		const replacement = coordinator.handleSupportedNetworkChange()
		inFlightCount = 1
		discovery.resolve()
		await Promise.resolve()
		inFlightCount = 0
		const transactionFinished = coordinator.handleTransactionFinished()
		rejectedReplacement.resolve()

		await Promise.all([replacement, transactionFinished])
		expect(replaceEnvironment).toHaveBeenCalledTimes(2)
	})

	test('drains a supported network change queued as the current replacement completes', async () => {
		let coordinator: ReturnType<typeof createSupportedNetworkChangeCoordinator>
		let replacementAttempt = 0
		const replaceEnvironment = mock(async () => {
			replacementAttempt += 1
			if (replacementAttempt === 1) queueMicrotask(() => void coordinator.handleSupportedNetworkChange())
			return true
		})
		coordinator = createSupportedNetworkChangeCoordinator({
			getInFlightCount: () => 0,
			replaceEnvironment,
		})

		await coordinator.handleSupportedNetworkChange()
		expect(replaceEnvironment).toHaveBeenCalledTimes(2)
	})
})

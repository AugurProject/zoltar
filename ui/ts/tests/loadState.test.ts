/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createLoadController, resolveLoadableValueState, resolveRequestedLoadableValueState, type LoadPhase } from '../lib/loadState.js'

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

void describe('load state helpers', () => {
	void test('starts idle and exposes loading state during successful runs', async () => {
		const controller = createLoadController()
		let started = false
		let successValue: number | undefined
		const deferred = createDeferred<number>()
		const initialPhase: LoadPhase = controller.phase.value

		expect(initialPhase).toBe('idle')
		expect(controller.isLoading.value).toBe(false)

		const runPromise = controller.run({
			onStart: () => {
				started = true
			},
			load: async () => await deferred.promise,
			onSuccess: value => {
				successValue = value
			},
		})

		expect(controller.phase.value).toBe('loading')
		expect(controller.isLoading.value).toBe(true)
		expect(started).toBe(true)

		deferred.resolve(42)
		await expect(runPromise).resolves.toBe(42)

		expect(successValue).toBe(42)
		expect(controller.phase.value).toBe('idle')
		expect(controller.isLoading.value).toBe(false)
	})

	void test('skips stale success handlers and still returns to idle', async () => {
		const controller = createLoadController()
		let current = true
		let successCalled = false

		await controller.run({
			isCurrent: () => current,
			load: async () => {
				current = false
				return 1
			},
			onSuccess: () => {
				successCalled = true
			},
		})

		expect(successCalled).toBe(false)
		expect(controller.phase.value).toBe('idle')
		expect(controller.isLoading.value).toBe(false)
	})

	void test('invokes error handlers, clears loading, and returns undefined on errors', async () => {
		const controller = createLoadController()
		let errorMessage: string | undefined

		await expect(
			controller.run({
				load: async () => {
					throw new Error('boom')
				},
				onSuccess: () => undefined,
				onError: error => {
					errorMessage = error instanceof Error ? error.message : 'unknown'
				},
			}),
		).resolves.toBeUndefined()

		expect(errorMessage).toBe('boom')
		expect(controller.phase.value).toBe('idle')
		expect(controller.isLoading.value).toBe(false)
	})

	void test('skips stale error handlers', async () => {
		const controller = createLoadController()
		let current = true
		let errorCalled = false

		await controller.run({
			isCurrent: () => current,
			load: async () => {
				current = false
				throw new Error('boom')
			},
			onError: () => {
				errorCalled = true
			},
		})

		expect(errorCalled).toBe(false)
		expect(controller.phase.value).toBe('idle')
		expect(controller.isLoading.value).toBe(false)
	})

	void test('tracks overlapping work until the last task settles', async () => {
		const controller = createLoadController()
		const first = createDeferred<number>()
		const second = createDeferred<number>()

		const firstTask = controller.track(async () => await first.promise)
		const secondTask = controller.track(async () => await second.promise)

		expect(controller.phase.value).toBe('loading')
		expect(controller.isLoading.value).toBe(true)

		first.resolve(1)
		await expect(firstTask).resolves.toBe(1)
		expect(controller.phase.value).toBe('loading')
		expect(controller.isLoading.value).toBe(true)

		second.resolve(2)
		await expect(secondTask).resolves.toBe(2)
		expect(controller.phase.value).toBe('idle')
		expect(controller.isLoading.value).toBe(false)
	})

	void test('rethrows track errors after clearing loading state', async () => {
		const controller = createLoadController()

		await expect(
			controller.track(async () => {
				throw new Error('track boom')
			}),
		).rejects.toThrow('track boom')

		expect(controller.phase.value).toBe('idle')
		expect(controller.isLoading.value).toBe(false)
	})

	void test('resolves loadable value states from explicit missing truth', () => {
		expect(resolveLoadableValueState({ isLoading: false, isMissing: false, value: undefined })).toBe('unknown')
		expect(resolveLoadableValueState({ isLoading: true, isMissing: false, value: undefined })).toBe('loading')
		expect(resolveLoadableValueState({ isLoading: false, isMissing: true, value: undefined })).toBe('missing')
		expect(resolveLoadableValueState({ isLoading: false, isMissing: false, value: 42 })).toBe('ready')
	})

	void test('resolves requested loadable value states for the current key only', () => {
		expect(resolveRequestedLoadableValueState({ currentKey: 'pool-a', isLoading: false, resolvedKey: undefined, value: undefined })).toBe('unknown')
		expect(resolveRequestedLoadableValueState({ currentKey: 'pool-a', isLoading: true, resolvedKey: undefined, value: undefined })).toBe('loading')
		expect(resolveRequestedLoadableValueState({ currentKey: 'pool-a', isLoading: false, resolvedKey: 'pool-b', value: undefined })).toBe('unknown')
		expect(resolveRequestedLoadableValueState({ currentKey: 'pool-a', isLoading: false, resolvedKey: 'pool-a', value: undefined })).toBe('missing')
		expect(resolveRequestedLoadableValueState({ currentKey: 'pool-a', isLoading: false, resolvedKey: 'pool-a', value: 42 })).toBe('ready')
	})
})

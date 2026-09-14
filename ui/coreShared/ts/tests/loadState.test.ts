/// <reference types="bun-types" />

import { describe, expect, spyOn, test } from 'bun:test'
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
	void test('bounds backend readiness and allows retry without running a premature read', async () => {
		const originalSetTimeout = globalThis.setTimeout
		const timer = spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => originalSetTimeout(handler, delay === 120_000 ? 5 : delay, ...args))
		const controller = createLoadController()
		let reads = 0
		let failure: unknown
		try {
			await controller.run({
				waitUntilReady: () => new Promise(() => undefined),
				load: async () => {
					reads += 1
					return 42
				},
				onError: error => {
					failure = error
				},
			})
			expect(failure).toBeInstanceOf(Error)
			expect(failure instanceof Error ? failure.message : '').toContain('Backend readiness timed out')
			expect(reads).toBe(0)
			expect(controller.isLoading.value).toBe(false)
			expect(await controller.run({ waitUntilReady: async () => undefined, load: async () => 42 })).toBe(42)
		} finally {
			timer.mockRestore()
		}
	})

	void test('starts the read deadline after backend readiness', async () => {
		const controller = createLoadController({ timeoutMilliseconds: 5 })
		const ready = createDeferred<void>()
		let reads = 0
		const pending = controller.run({
			waitUntilReady: () => ready.promise,
			load: async () => {
				reads += 1
				return 42
			},
		})
		await new Promise(resolve => setTimeout(resolve, 20))
		expect(reads).toBe(0)
		expect(controller.isLoading.value).toBe(true)
		ready.resolve()
		expect(await pending).toBe(42)
		expect(controller.isLoading.value).toBe(false)
	})

	void test('times out a stalled read, allows retry, and ignores its late result', async () => {
		const controller = createLoadController({ timeoutMilliseconds: 5 })
		const stalled = createDeferred<number>()
		const values: number[] = []
		let errorMessage: string | undefined
		const pending = controller.run({
			load: () => stalled.promise,
			onSuccess: value => {
				values.push(value)
			},
			onError: error => {
				errorMessage = error instanceof Error ? error.message : String(error)
			},
		})
		try {
			await Promise.race([pending, new Promise(resolve => setTimeout(resolve, 50))])
			expect(controller.isLoading.value).toBe(false)
			expect(errorMessage).toContain('timed out')
			await controller.run({
				load: async () => 2,
				onSuccess: value => {
					values.push(value)
				},
			})
			stalled.resolve(1)
			await pending
			expect(values).toEqual([2])
		} finally {
			stalled.resolve(1)
		}
	})

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

	void test('invalidates stale pending work without letting it affect newer loading state', async () => {
		const controller = createLoadController()
		const stale = createDeferred<number>()
		const current = createDeferred<number>()
		const staleTask = controller.track(async () => await stale.promise)

		expect(controller.isLoading.value).toBe(true)
		controller.invalidate()
		expect(controller.isLoading.value).toBe(false)

		const currentTask = controller.track(async () => await current.promise)
		current.resolve(2)
		await currentTask
		expect(controller.isLoading.value).toBe(false)

		stale.resolve(1)
		await staleTask
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

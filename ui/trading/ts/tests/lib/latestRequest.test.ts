import { describe, expect, test } from 'bun:test'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'

function deferred<T>() {
	let resolvePromise: (value: T) => void = () => undefined
	const promise = new Promise<T>(resolve => {
		resolvePromise = resolve
	})
	return { promise, resolve: resolvePromise }
}

describe('latest asynchronous request guard', () => {
	test('discards a simulation completion after its inputs are invalidated', async () => {
		const guard = createLatestRequestGuard()
		const response = deferred<string>()
		const request = guard.begin()
		let submittedQuote: string | undefined
		const completion = response.promise.then(value => {
			if (guard.isCurrent(request)) submittedQuote = value
		})

		guard.invalidate()
		response.resolve('stale YES quote for the prior pool')
		await completion

		expect(submittedQuote).toBeUndefined()
	})

	test('allows only the newest out-of-order balance completion to commit', async () => {
		const guard = createLatestRequestGuard()
		const firstResponse = deferred<string>()
		const firstRequest = guard.begin()
		const secondResponse = deferred<string>()
		const secondRequest = guard.begin()
		let visibleBalance: string | undefined
		const firstCompletion = firstResponse.promise.then(value => {
			if (guard.isCurrent(firstRequest)) visibleBalance = value
		})
		const secondCompletion = secondResponse.promise.then(value => {
			if (guard.isCurrent(secondRequest)) visibleBalance = value
		})

		secondResponse.resolve('new pool balance')
		await secondCompletion
		firstResponse.resolve('old pool balance')
		await firstCompletion

		expect(visibleBalance).toBe('new pool balance')
	})
})

describe('exclusive asynchronous workflow guard', () => {
	test('admits exactly one wallet workflow until the active one finishes', () => {
		const guard = createExclusiveWorkflowGuard()
		expect(guard.begin()).toBeTrue()
		expect(guard.begin()).toBeFalse()
		expect(guard.isActive()).toBeTrue()
		guard.finish()
		expect(guard.isActive()).toBeFalse()
		expect(guard.begin()).toBeTrue()
	})

	test('prevents a rapid second wallet write while the first preflight is deferred', async () => {
		const guard = createExclusiveWorkflowGuard()
		const preflight = deferred<void>()
		let writes = 0
		const submit = async () => {
			if (!guard.begin()) return
			try {
				await preflight.promise
				writes += 1
			} finally {
				guard.finish()
			}
		}
		const first = submit()
		const duplicate = submit()
		expect(guard.isActive()).toBeTrue()
		expect(writes).toBe(0)
		preflight.resolve()
		await Promise.all([first, duplicate])
		expect(writes).toBe(1)
	})
})

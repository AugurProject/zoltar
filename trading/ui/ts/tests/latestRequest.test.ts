import { describe, expect, test } from 'bun:test'
import { createLatestRequestGuard } from '../app/latestRequest.ts'

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

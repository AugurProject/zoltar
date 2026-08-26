/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { createExclusiveWorkflowGuard, createLatestRequestGuard, useRequestGuard } from '../lib/requestGuard.js'

function deferred<T>() {
	let resolvePromise: (value: T) => void = () => undefined
	const promise = new Promise<T>(resolve => {
		resolvePromise = resolve
	})
	return { promise, resolve: resolvePromise }
}

describe('request guard', () => {
	let cleanupDom: (() => void) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
	})

	afterEach(() => {
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('invalidates pending work when its component unmounts', async () => {
		let isCurrent: (() => boolean) | undefined
		function Harness() {
			const nextRequest = useRequestGuard()
			isCurrent = nextRequest()
			return <div />
		}

		const rendered = await renderIntoDocument(<Harness />)
		expect(isCurrent?.()).toBeTrue()
		await rendered.unmount()
		expect(isCurrent?.()).toBeFalse()
	})

	test('keeps only the latest non-component request current', () => {
		const guard = createLatestRequestGuard()
		const first = guard.begin()
		const second = guard.begin()

		expect(guard.isCurrent(first)).toBeFalse()
		expect(guard.isCurrent(second)).toBeTrue()
		guard.invalidate()
		expect(guard.isCurrent(second)).toBeFalse()
	})

	test('discards invalidated and out-of-order asynchronous completions', async () => {
		const guard = createLatestRequestGuard()
		const firstResponse = deferred<string>()
		const firstRequest = guard.begin()
		const secondResponse = deferred<string>()
		const secondRequest = guard.begin()
		let visibleValue: string | undefined
		const firstCompletion = firstResponse.promise.then(value => {
			if (guard.isCurrent(firstRequest)) visibleValue = value
		})
		const secondCompletion = secondResponse.promise.then(value => {
			if (guard.isCurrent(secondRequest)) visibleValue = value
		})

		secondResponse.resolve('current value')
		await secondCompletion
		firstResponse.resolve('stale value')
		await firstCompletion
		expect(visibleValue).toBe('current value')

		guard.invalidate()
		expect(guard.isCurrent(secondRequest)).toBeFalse()
	})

	test('serializes exclusive non-component workflows', () => {
		const guard = createExclusiveWorkflowGuard()

		expect(guard.begin()).toBeTrue()
		expect(guard.begin()).toBeFalse()
		expect(guard.isActive()).toBeTrue()
		guard.finish()
		expect(guard.begin()).toBeTrue()
	})

	test('prevents duplicate asynchronous work while the first preflight is pending', async () => {
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
		preflight.resolve()
		await Promise.all([first, duplicate])
		expect(writes).toBe(1)
	})
})

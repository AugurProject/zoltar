/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { createExclusiveWorkflowGuard, createLatestRequestGuard, useRequestGuard } from '../lib/requestGuard.js'

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

	test('serializes exclusive non-component workflows', () => {
		const guard = createExclusiveWorkflowGuard()

		expect(guard.begin()).toBeTrue()
		expect(guard.begin()).toBeFalse()
		expect(guard.isActive()).toBeTrue()
		guard.finish()
		expect(guard.begin()).toBeTrue()
	})
})

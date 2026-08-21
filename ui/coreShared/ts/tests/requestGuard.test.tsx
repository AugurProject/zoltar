/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { useRequestGuard } from '../lib/requestGuard.js'

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
})

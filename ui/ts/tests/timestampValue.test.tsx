/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { TimestampValue } from '../components/TimestampValue.js'
import { ChainTimestampContext } from '../lib/chainTimestamp.js'
import { formatTimestamp } from '../lib/formatters.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('TimestampValue', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreDomEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('prefers an explicit current timestamp over the shared chain timestamp context', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={900n}>
				<TimestampValue currentTimestamp={1_000n} timestamp={1_060n} />
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('(in 1m)')).toBe(true)
		expect(document.body.textContent?.includes('(in 2m)')).toBe(false)
	})

	test('uses the shared chain timestamp context when no explicit timestamp is provided', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={900n}>
				<TimestampValue timestamp={1_060n} />
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('(in 2m)')).toBe(true)
	})

	test('omits relative time when no chain timestamp is available', async () => {
		const renderedComponent = await renderIntoDocument(<TimestampValue timestamp={840n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes(formatTimestamp(840n))).toBe(true)
		expect(document.body.querySelector('.timestamp-value-relative')).toBeNull()
	})
})

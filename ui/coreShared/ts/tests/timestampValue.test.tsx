/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { TimestampValue } from '../components/TimestampValue.js'
import { formatLocalTimestamp, formatTimestamp } from '../lib/formatters.js'
import { ChainTimestampContext } from '../wallet/chainTimestamp.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('TimestampValue', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
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

	test('uses wall-clock relative time when no chain timestamp is available', async () => {
		const renderedComponent = await renderIntoDocument(<TimestampValue timestamp={840n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes(formatTimestamp(840n))).toBe(true)
		expect(document.body.querySelector('.timestamp-value-relative')?.textContent).toContain('ago')
	})

	test('absolute-only timestamps retain semantic time and omit relative text', async () => {
		const renderedComponent = await renderIntoDocument(<TimestampValue timestamp={1_060n} relative={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(document.querySelector('time')?.getAttribute('datetime')).toBe('1970-01-01T00:17:40.000Z')
		expect(document.querySelector('.timestamp-value-relative')).toBeNull()
	})

	test('renders loading timestamps with a silent spinner so many loading values do not mount many live regions', async () => {
		const renderedComponent = await renderIntoDocument(<TimestampValue loading timestamp={undefined} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const loadingValue = document.body.querySelector('.timestamp-value.loading')
		expect(loadingValue?.textContent).toContain('Loading…')
		expect(loadingValue?.querySelector('.spinner')).not.toBeNull()
		expect(loadingValue?.getAttribute('role')).toBeNull()
		expect(loadingValue?.getAttribute('aria-live')).toBeNull()
	})

	test('keeps UTC visible and offers the viewer local time where it differs, instead of repeating the visible text', async () => {
		const timestamp = 1_700_000_000n
		const renderedComponent = await renderIntoDocument(<TimestampValue currentTimestamp={timestamp} timestamp={timestamp} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const time = document.querySelector('time')
		expect(time?.textContent).toContain('2023-11-14 22:13:20 UTC')
		const localTimestamp = formatLocalTimestamp(timestamp)
		if (localTimestamp === undefined) {
			expect(time?.getAttribute('title')).toBe('2023-11-14 22:13:20 UTC')
			expect(time?.querySelector('.visually-hidden')).toBeNull()
		} else {
			expect(time?.getAttribute('title')).toBe(`Local time ${localTimestamp}`)
			expect(time?.querySelector('.visually-hidden')?.textContent).toBe(`Local time ${localTimestamp}`)
		}
	})

	test('renders an invalid timestamp without crashing', async () => {
		const invalidTimestamp = 10n ** 30n
		const renderedComponent = await renderIntoDocument(<TimestampValue timestamp={invalidTimestamp} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const invalidValue = document.body.querySelector('.timestamp-value.error')
		expect(invalidValue?.textContent).toContain(`Invalid timestamp (${invalidTimestamp.toString()})`)
		expect(document.body.querySelector('time')).toBeNull()
	})
})

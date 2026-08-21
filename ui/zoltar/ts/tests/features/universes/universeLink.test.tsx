/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { UniverseLink } from '../../../features/universes/components/UniverseLink.js'
import { getUniverseLinkHref } from '../../../features/universes/lib/universe.js'

installTestRouting()
describe('UniverseLink', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let previousPopStateEventDescriptor: PropertyDescriptor | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		previousPopStateEventDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'PopStateEvent')
		Object.defineProperty(globalThis, 'PopStateEvent', {
			configurable: true,
			value: domEnvironment.window.PopStateEvent,
			writable: true,
		})
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		if (previousPopStateEventDescriptor === undefined) {
			delete (globalThis as typeof globalThis & { PopStateEvent?: typeof window.PopStateEvent }).PopStateEvent
		} else {
			Object.defineProperty(globalThis, 'PopStateEvent', previousPopStateEventDescriptor)
		}
		previousPopStateEventDescriptor = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders the default universe label and follows normal left-click navigation', async () => {
		const renderedComponent = await renderIntoDocument(<UniverseLink universeId={10n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: 'Universe 0xa' }) as HTMLAnchorElement
		const expectedHref = getUniverseLinkHref(10n)
		expect(link.getAttribute('href')).toBe(expectedHref)
		let popstateCount = 0
		window.addEventListener('popstate', () => {
			popstateCount += 1
		})

		await act(() => {
			fireEvent.click(link)
		})
		expect(window.location.hash).toBe(expectedHref)
		expect(popstateCount).toBe(1)
	})

	test('renders custom children and keeps modified clicks on the link href', async () => {
		const renderedComponent = await renderIntoDocument(<UniverseLink universeId={7n}>Open Universe</UniverseLink>)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: 'Open Universe' }) as HTMLAnchorElement
		expect(link).not.toBeNull()
		const expectedHref = getUniverseLinkHref(7n)
		let popstateCount = 0
		window.addEventListener('popstate', () => {
			popstateCount += 1
		})

		await act(() => {
			fireEvent.click(link, { ctrlKey: true })
		})
		expect(link.getAttribute('href')).toBe(expectedHref)
		expect(popstateCount).toBe(0)
	})

	test('renders the universe id in hex when requested', async () => {
		const renderedComponent = await renderIntoDocument(<UniverseLink format='hex' universeId={15n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: '0xf' }) as HTMLAnchorElement
		expect(link.getAttribute('href')).toBe(getUniverseLinkHref(15n))
	})

	test('abbreviates a long universe id visually while preserving its complete accessible name', async () => {
		const universeId = BigInt('0x1234567890abcdef1234567890abcdef1234567890abcdef')
		const renderedComponent = await renderIntoDocument(<UniverseLink universeId={universeId} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const fullLabel = `Universe 0x${universeId.toString(16)}`
		const link = within(document.body).getByRole('link', { name: fullLabel }) as HTMLAnchorElement
		expect(link.textContent).toBe('Universe 0x12345678…abcdef')
		expect(link.title).toBe(fullLabel)
	})
})

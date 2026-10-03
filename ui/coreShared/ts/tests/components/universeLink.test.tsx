/// <reference types='bun-types' />

import { installLinkNavigationLifecycle } from '../testUtils/domTestLifecycle.js'
import { fireEvent, within } from '../testUtils/queries.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { installTestRouting } from '../testUtils/testRouting.js'
import { UniverseLink } from '../../components/UniverseLink.js'
import { getUniverseLinkHref } from '../../navigation/universeNavigation.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'

installTestRouting()
describe('UniverseLink', () => {
	const { trackCleanup } = installLinkNavigationLifecycle()

	test('renders the default universe label and follows normal left-click navigation', async () => {
		const renderedComponent = await renderIntoDocument(<UniverseLink universeId={10n} />)
		trackCleanup(renderedComponent.cleanup)

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
		trackCleanup(renderedComponent.cleanup)

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

	test('uses an explicit browser destination without intercepting browser navigation', async () => {
		const component = await renderIntoDocument(
			<UniverseLink href='#/pools/universes?universe=7' universeId={7n}>
				Open Yes universe
			</UniverseLink>,
		)
		trackCleanup(component.cleanup)
		const link = within(document.body).getByRole('link', { name: 'Open Yes universe' })
		expect(link.getAttribute('href')).toBe('#/pools/universes?universe=7')
		const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
		await act(() => link.dispatchEvent(event))
		expect(event.defaultPrevented).toBe(false)
	})

	test('renders the universe id in hex when requested', async () => {
		const renderedComponent = await renderIntoDocument(<UniverseLink format='hex' universeId={15n} />)
		trackCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: '0xf' }) as HTMLAnchorElement
		expect(link.getAttribute('href')).toBe(getUniverseLinkHref(15n))
	})

	test('abbreviates a long universe id visually while preserving its complete accessible name', async () => {
		const universeId = BigInt('0x1234567890abcdef1234567890abcdef1234567890abcdef')
		const renderedComponent = await renderIntoDocument(<UniverseLink universeId={universeId} />)
		trackCleanup(renderedComponent.cleanup)

		const fullLabel = `Universe 0x${universeId.toString(16)}`
		const link = within(document.body).getByRole('link', { name: fullLabel }) as HTMLAnchorElement
		expect(link.textContent).toBe('Universe 0x123456…cdef')
		expect(link.title).toBe(fullLabel)
	})
})

/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { UniverseLink } from '../components/UniverseLink.js'

describe('UniverseLink', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let navigateToUniverse = mock(async () => undefined)

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		navigateToUniverse = mock(async () => undefined)
		mock.module('../lib/universe.js', () => ({
			formatUniverseLabel: (universeId: bigint) => `Universe ${universeId.toString()}`,
			getUniverseLinkHref: (universeId: bigint) => `/universe/${universeId.toString()}`,
			navigateToUniverse,
		}))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('renders the default universe label and follows normal left-click navigation', async () => {
		const renderedComponent = await renderIntoDocument(<UniverseLink universeId={10n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: 'Universe 10' }) as HTMLAnchorElement
		expect(link.getAttribute('href')).toBe('/universe/10')

		await act(() => {
			fireEvent.click(link)
		})
		expect(navigateToUniverse).toHaveBeenCalledTimes(1)
		expect(navigateToUniverse).toHaveBeenCalledWith(10n)
	})

	test('renders custom children and ignores clicks with navigation modifiers', async () => {
		const renderedComponent = await renderIntoDocument(<UniverseLink universeId={7n}>Open Universe</UniverseLink>)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: 'Open Universe' }) as HTMLAnchorElement
		expect(link).not.toBeNull()

		await act(() => {
			fireEvent.click(link, { ctrlKey: true })
		})
		expect(navigateToUniverse).not.toHaveBeenCalled()
	})
})

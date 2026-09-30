/// <reference types='bun-types' />

import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { installLinkNavigationLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { StatoblastSecurityPoolLink } from '@zoltar/ui-statoblast-shared/features/security-pools/components/StatoblastSecurityPoolLink.js'
import { getSecurityPoolLinkHref } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolNavigation.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'

installTestRouting()
describe('StatoblastSecurityPoolLink', () => {
	const { trackCleanup } = installLinkNavigationLifecycle()

	test('renders the shared address value and follows normal left-click navigation', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const renderedComponent = await renderIntoDocument(<StatoblastSecurityPoolLink securityPoolAddress={securityPoolAddress} selectedPoolView='fork-workflow' universeId={11n} />)
		trackCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: securityPoolAddress })
		expect(link.querySelector('.address-value')?.getAttribute('title')).toBe(securityPoolAddress)
		expect(link.querySelector('.address-value-full')?.textContent).toBe(securityPoolAddress)
		const expectedHref = getSecurityPoolLinkHref(securityPoolAddress, 'fork-workflow', 11n)
		expect(expectedHref.split('?')[0]).toBe(`#/pools/${securityPoolAddress}/fork-workflow`)
		expect(link.getAttribute('href')).toBe(expectedHref)
		let hashchangeCount = 0
		window.addEventListener('hashchange', () => {
			hashchangeCount += 1
		})

		await act(() => {
			fireEvent.click(link)
		})
		expect(window.location.hash).toBe(expectedHref)
		expect(hashchangeCount).toBe(1)
	})

	test('renders custom children and keeps modified clicks on the link href', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const renderedComponent = await renderIntoDocument(<StatoblastSecurityPoolLink securityPoolAddress={securityPoolAddress}>Parent pool</StatoblastSecurityPoolLink>)
		trackCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: 'Parent pool' }) as HTMLAnchorElement
		expect(link).not.toBeNull()
		const expectedHref = getSecurityPoolLinkHref(securityPoolAddress)
		let hashchangeCount = 0
		window.addEventListener('hashchange', () => {
			hashchangeCount += 1
		})

		await act(() => {
			fireEvent.click(link, { ctrlKey: true })
		})
		expect(link.getAttribute('href')).toBe(expectedHref)
		expect(hashchangeCount).toBe(0)
	})
})

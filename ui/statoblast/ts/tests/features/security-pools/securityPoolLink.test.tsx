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

	test('separates the copyable explorer address from the pool navigation link', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const renderedComponent = await renderIntoDocument(<StatoblastSecurityPoolLink securityPoolAddress={securityPoolAddress} selectedPoolView='fork-workflow' universeId={11n} />)
		trackCleanup(renderedComponent.cleanup)

		const documentQueries = within(document.body)
		const addressLink = renderedComponent.container.querySelector('a.address-value')
		expect(addressLink?.getAttribute('title')).toBe(securityPoolAddress)
		expect(addressLink?.getAttribute('href')).toBe(`https://sepolia.etherscan.io/address/${securityPoolAddress}`)
		expect(addressLink?.querySelector('.address-value-full')?.textContent).toBe(securityPoolAddress)
		expect(documentQueries.getByRole('button', { name: `Copy address ${securityPoolAddress}` })).not.toBeNull()
		const link = documentQueries.getByRole('link', { name: 'Open pool' })
		expect(link.querySelector('a, button') === null).toBe(true)
		const expectedHref = getSecurityPoolLinkHref(securityPoolAddress, 'fork-workflow', 11n)
		expect(expectedHref.split('?')[0]).toBe(`#/pools/${securityPoolAddress}/fork-workflow`)
		expect(link.getAttribute('href')).toBe(expectedHref)
		let hashchangeCount = 0
		window.addEventListener('hashchange', () => {
			hashchangeCount += 1
		})

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: `Copy address ${securityPoolAddress}` }))
		})
		expect(hashchangeCount).toBe(0)
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

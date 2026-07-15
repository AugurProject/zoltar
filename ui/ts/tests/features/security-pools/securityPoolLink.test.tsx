/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '../../testUtils/queries'
import { act } from 'preact/test-utils'
import { getAddress } from '@zoltar/shared/ethereum'
import { SecurityPoolLink } from '../../../features/security-pools/components/SecurityPoolLink.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { getSecurityPoolLinkHref } from '../../../features/security-pools/lib/securityPoolNavigation.js'

describe('SecurityPoolLink', () => {
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

	test('renders the full pool address and follows normal left-click navigation', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const renderedComponent = await renderIntoDocument(<SecurityPoolLink securityPoolAddress={securityPoolAddress} selectedPoolView='fork-workflow' universeId={11n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: securityPoolAddress }) as HTMLAnchorElement
		const expectedHref = getSecurityPoolLinkHref(securityPoolAddress, 'fork-workflow', 11n)
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
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const renderedComponent = await renderIntoDocument(<SecurityPoolLink securityPoolAddress={securityPoolAddress}>Parent pool</SecurityPoolLink>)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: 'Parent pool' }) as HTMLAnchorElement
		expect(link).not.toBeNull()
		const expectedHref = getSecurityPoolLinkHref(securityPoolAddress)
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
})

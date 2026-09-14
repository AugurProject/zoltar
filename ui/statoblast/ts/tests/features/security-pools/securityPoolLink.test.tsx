/// <reference types='bun-types' />

import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { SecurityPoolLink } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolLink.js'
import { getSecurityPoolLinkHref } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolNavigation.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'

installTestRouting()
describe('SecurityPoolLink', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let previousPopStateEventDescriptor: PropertyDescriptor | undefined

	installDomTestLifecycle({
		beforeTest: domEnvironment => {
			previousPopStateEventDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'PopStateEvent')
			Object.defineProperty(globalThis, 'PopStateEvent', {
				configurable: true,
				value: domEnvironment.window.PopStateEvent,
				writable: true,
			})
		},
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			if (previousPopStateEventDescriptor === undefined) {
				delete (globalThis as typeof globalThis & { PopStateEvent?: typeof window.PopStateEvent }).PopStateEvent
			} else {
				Object.defineProperty(globalThis, 'PopStateEvent', previousPopStateEventDescriptor)
			}
			previousPopStateEventDescriptor = undefined
		},
	})

	test('renders the full pool address and follows normal left-click navigation', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const renderedComponent = await renderIntoDocument(<SecurityPoolLink securityPoolAddress={securityPoolAddress} selectedPoolView='fork-workflow' universeId={11n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: securityPoolAddress }) as HTMLAnchorElement
		const expectedHref = getSecurityPoolLinkHref(securityPoolAddress, 'fork-workflow', 11n)
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
		const renderedComponent = await renderIntoDocument(<SecurityPoolLink securityPoolAddress={securityPoolAddress}>Parent pool</SecurityPoolLink>)
		cleanupRenderedComponent = renderedComponent.cleanup

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

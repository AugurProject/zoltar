/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { getAddress } from '@zoltar/shared/ethereum'
import { SecurityPoolLink } from '../components/SecurityPoolLink.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('SecurityPoolLink', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let navigateToSecurityPool = mock(async () => undefined)

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		navigateToSecurityPool = mock(async () => undefined)
		mock.module('../lib/securityPoolNavigation.js', () => ({
			getSecurityPoolLinkHref: (securityPoolAddress: string, selectedPoolView?: string, universeId?: bigint) => `/security-pools/${securityPoolAddress}/${selectedPoolView ?? ''}/${universeId?.toString() ?? ''}`,
			navigateToSecurityPool,
		}))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('renders the full pool address and follows normal left-click navigation', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const renderedComponent = await renderIntoDocument(<SecurityPoolLink securityPoolAddress={securityPoolAddress} selectedPoolView='fork-workflow' universeId={11n} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: securityPoolAddress }) as HTMLAnchorElement
		expect(link.getAttribute('href')).toBe(`/security-pools/${securityPoolAddress}/fork-workflow/11`)

		await act(() => {
			fireEvent.click(link)
		})
		expect(navigateToSecurityPool).toHaveBeenCalledTimes(1)
		expect(navigateToSecurityPool).toHaveBeenCalledWith(securityPoolAddress, 'fork-workflow', 11n)
	})

	test('renders custom children and ignores clicks with navigation modifiers', async () => {
		const securityPoolAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const renderedComponent = await renderIntoDocument(<SecurityPoolLink securityPoolAddress={securityPoolAddress}>Parent pool</SecurityPoolLink>)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const link = documentQueries.getByRole('link', { name: 'Parent pool' }) as HTMLAnchorElement
		expect(link).not.toBeNull()

		await act(() => {
			fireEvent.click(link, { ctrlKey: true })
		})
		expect(navigateToSecurityPool).not.toHaveBeenCalled()
	})
})

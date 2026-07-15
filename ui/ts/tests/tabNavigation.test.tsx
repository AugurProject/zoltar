/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { TabNavigation } from '../components/TabNavigation.js'
import { DEPLOY_ROUTE, OPEN_ORACLE_ROUTE, SECURITY_POOLS_ROUTE, ZOLTAR_ROUTE } from '../lib/routing.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { fireEvent, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createProps(overrides: Partial<Parameters<typeof TabNavigation>[0]> = {}): Parameters<typeof TabNavigation>[0] {
	return {
		augurPlaceHolderDeployed: true,
		deployRoute: DEPLOY_ROUTE,
		marketRoute: ZOLTAR_ROUTE,
		onRouteChange: () => undefined,
		openOracleRoute: OPEN_ORACLE_ROUTE,
		route: 'zoltar',
		securityPoolsRoute: SECURITY_POOLS_ROUTE,
		showDeployTab: true,
		...overrides,
	}
}

describe('TabNavigation', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment('http://localhost/#/zoltar?universe=7&simulate=1').cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('renders the user-facing application section labels', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps()))
		cleanupRenderedComponent = rendered.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('navigation', { name: 'Application sections' })).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: 'Deploy' }).getAttribute('href')).toBe('#/deploy?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Markets' }).getAttribute('href')).toBe('#/zoltar?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Markets' }).getAttribute('aria-current')).toBe('page')
		expect(documentQueries.getByRole('link', { name: 'Security Pools' }).getAttribute('href')).toBe('#/security-pools?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Oracle Reports' }).getAttribute('href')).toBe('#/open-oracle?universe=7&simulate=1')
		expect(documentQueries.queryByRole('link', { name: 'Zoltar' })).toBeNull()
		expect(documentQueries.queryByRole('link', { name: 'Open Oracle' })).toBeNull()
	})

	test('uses the deployment prerequisite copy for disabled application sections', async () => {
		const routeChanges: string[] = []
		const rendered = await renderIntoDocument(
			h(
				TabNavigation,
				createProps({
					augurPlaceHolderDeployed: false,
					onRouteChange: route => {
						routeChanges.push(route)
					},
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup

		const marketsTab = within(document.body).getByRole('button', { name: 'Markets' }) as HTMLButtonElement
		expect(marketsTab.disabled).toBe(true)
		expect(marketsTab.title).toBe('Deploy the application contracts before using this section.')
		expect(marketsTab.getAttribute('aria-description')).toBe('Deploy the application contracts before using this section.')

		fireEvent.click(marketsTab)
		expect(routeChanges).toEqual([])
	})

	test('preserves the current hash query state in top-level tab hrefs', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps()))
		cleanupRenderedComponent = rendered.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('link', { name: 'Deploy' }).getAttribute('href')).toBe('#/deploy?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Markets' }).getAttribute('href')).toBe('#/zoltar?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Security Pools' }).getAttribute('href')).toBe('#/security-pools?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Oracle Reports' }).getAttribute('href')).toBe('#/open-oracle?universe=7&simulate=1')
	})

	test('preserves the current route for modified and auxiliary link clicks', async () => {
		const routeChanges: string[] = []
		const rendered = await renderIntoDocument(
			h(
				TabNavigation,
				createProps({
					onRouteChange: route => {
						routeChanges.push(route)
					},
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup

		const securityPoolsLink = within(document.body).getByRole('link', { name: 'Security Pools' })
		const locationBeforeClicks = window.location.href
		const preventNativeNavigation = (event: Event) => event.preventDefault()
		document.body.addEventListener('click', preventNativeNavigation)
		for (const clickInit of [{ altKey: true }, { button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) fireEvent.click(securityPoolsLink, clickInit)

		expect(routeChanges).toEqual([])
		expect(window.location.href).toBe(locationBeforeClicks)
		document.body.removeEventListener('click', preventNativeNavigation)
	})
})

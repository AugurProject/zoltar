/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { TabNavigation, TabNavigationUnavailableReasons } from '../components/TabNavigation.js'
import type { RouteTabDefinition } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { fireEvent, waitFor, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { installTestRouting } from './testUtils/testRouting.js'

const DEFAULT_TABS: readonly RouteTabDefinition[] = [
	{ hash: '#/deploy', label: 'Deploy', route: 'deploy' },
	{ hash: '#/zoltar', label: 'Zoltar', route: 'zoltar' },
	{ hash: '#/security-pools', label: 'Security Pools', route: 'security-pools' },
	{ hash: '#/open-oracle', label: 'Open Oracle', route: 'open-oracle' },
]

function createProps(overrides: Partial<Parameters<typeof TabNavigation>[0]> = {}): Parameters<typeof TabNavigation>[0] {
	return {
		onRouteChange: () => undefined,
		route: 'zoltar',
		tabs: DEFAULT_TABS,
		...overrides,
	}
}

describe('TabNavigation', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		installTestRouting()
		cleanupDom = installDomEnvironment('http://localhost/#/zoltar?universe=7&zoltarView=create&simulate=1').cleanup
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
		expect(documentQueries.getByRole('link', { name: 'Zoltar' }).getAttribute('href')).toBe('#/zoltar?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Zoltar' }).getAttribute('aria-current')).toBe('page')
		expect(documentQueries.getByRole('link', { name: 'Security Pools' }).getAttribute('href')).toBe('#/security-pools?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Open Oracle' }).getAttribute('href')).toBe('#/open-oracle?universe=7&simulate=1')
		expect(documentQueries.queryByRole('combobox')).toBeNull()
		expect(documentQueries.queryByRole('link', { name: 'Protocol Guide' })).toBeNull()
	})

	test('omits an empty navigation landmark when only one application section is available', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps({ tabs: [{ hash: '#/zoltar', label: 'Questions', route: 'zoltar' }] })))
		cleanupRenderedComponent = rendered.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('link', { name: 'Questions' })).toBeNull()
		expect(documentQueries.queryByRole('navigation', { name: 'Application sections' })).toBeNull()
	})

	test('lists secondary sections under a More disclosure that marks the current section', async () => {
		const routeChanges: string[] = []
		const moreTabs: RouteTabDefinition[] = [
			{ hash: '#/liquidity', label: 'Liquidity', route: 'liquidity' },
			{ hash: '#/help', label: 'Help', route: 'help' },
		]
		const rendered = await renderIntoDocument(h(TabNavigation, createProps({ moreTabs, route: 'help', onRouteChange: route => void routeChanges.push(route) })))
		cleanupRenderedComponent = rendered.cleanup

		const documentQueries = within(document.body)
		const moreButton = documentQueries.getByRole('button', { name: 'More' })
		expect(moreButton.getAttribute('aria-expanded')).toBe('false')
		expect(moreButton.classList.contains('active')).toBe(true)
		expect(documentQueries.queryByRole('link', { name: 'Help' })).toBeNull()

		fireEvent.click(moreButton)
		expect(moreButton.getAttribute('aria-expanded')).toBe('true')
		const menu = document.getElementById(moreButton.getAttribute('aria-controls') ?? '')
		if (menu === null) throw new Error('Expected the More menu')
		expect(within(menu).getByRole('link', { name: 'Help' }).getAttribute('aria-current')).toBe('page')
		expect(within(menu).getByRole('link', { name: 'Liquidity' }).getAttribute('href')).toBe('#/liquidity?universe=7&simulate=1')

		fireEvent.keyDown(document, { key: 'Escape' })
		await waitFor(() => expect(moreButton.getAttribute('aria-expanded')).toBe('false'))
		expect(document.activeElement).toBe(moreButton)

		fireEvent.click(moreButton)
		fireEvent.click(documentQueries.getByRole('link', { name: 'Liquidity' }))
		expect(routeChanges).toEqual(['liquidity'])
		await waitFor(() => expect(documentQueries.queryByRole('link', { name: 'Liquidity' })).toBeNull())
	})

	test('keeps the first tab current when the route is unknown', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps({ route: 'not-found' })))
		cleanupRenderedComponent = rendered.cleanup

		expect(within(document.body).getByRole('link', { name: 'Deploy' }).getAttribute('aria-current')).toBe('page')
	})

	test('uses the disabled reason copy for disabled application sections', async () => {
		const disabledReason = 'Deploy the application contracts before using this section.'
		const disabledTabs = DEFAULT_TABS.map(tab => (tab.route === 'zoltar' ? { ...tab, disabled: true, disabledReason } : tab))
		const routeChanges: string[] = []
		const rendered = await renderIntoDocument(
			h(
				TabNavigation,
				createProps({
					onRouteChange: route => {
						routeChanges.push(route)
					},
					tabs: disabledTabs,
				}),
			),
		)
		const reasons = await renderIntoDocument(h(TabNavigationUnavailableReasons, { tabs: disabledTabs }))
		cleanupRenderedComponent = rendered.cleanup

		const documentQueries = within(document.body)
		const zoltarTab = documentQueries.getByRole('link', { name: 'Zoltar' }) as HTMLAnchorElement
		expect(zoltarTab.getAttribute('aria-disabled')).toBe('true')
		expect(zoltarTab.getAttribute('href')).toBeNull()
		expect(zoltarTab.tabIndex).toBe(0)
		expect(zoltarTab.title).toBe(disabledReason)
		expect(zoltarTab.getAttribute('aria-description')).toBe(disabledReason)
		expect(documentQueries.getByText(disabledReason, { selector: '.tab-nav-unavailable .disabled-reason' })).toBeDefined()

		zoltarTab.focus()
		expect(document.activeElement).toBe(zoltarTab)
		fireEvent.click(zoltarTab)
		expect(routeChanges).toEqual([])
		await reasons.cleanup()
	})

	test('explains a shared lock once instead of repeating it per tab', async () => {
		const disabledReason = 'Transaction in progress.'
		const rendered = await renderIntoDocument(h(TabNavigationUnavailableReasons, { tabs: DEFAULT_TABS.map(tab => ({ ...tab, disabled: true, disabledReason })) }))
		cleanupRenderedComponent = rendered.cleanup

		const reasons = document.body.querySelectorAll('.tab-nav-unavailable .disabled-reason')
		expect(reasons.length).toBe(1)
		expect(reasons[0]?.textContent).toBe(disabledReason)
	})

	test('keeps shared and destination-owned query state in top-level tab hrefs', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps()))
		cleanupRenderedComponent = rendered.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('link', { name: 'Deploy' }).getAttribute('href')).toBe('#/deploy?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Zoltar' }).getAttribute('href')).toBe('#/zoltar?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Security Pools' }).getAttribute('href')).toBe('#/security-pools?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Open Oracle' }).getAttribute('href')).toBe('#/open-oracle?universe=7&simulate=1')
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

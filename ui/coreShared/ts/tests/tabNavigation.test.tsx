/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { TabNavigation, TabNavigationUnavailableReasons } from '../components/TabNavigation.js'
import type { RouteTabDefinition } from '../types/components.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { fireEvent, waitFor, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { installTestRouting } from './testUtils/testRouting.js'
import { readCoreSharedCssSource } from './testUtils/coreSharedCss.js'

const DEFAULT_TABS: readonly RouteTabDefinition[] = [
	{ hash: '#/deploy', label: 'Deploy', route: 'deploy' },
	{ hash: '#/zoltar', label: 'Zoltar', route: 'zoltar' },
	{ hash: '#/security-pools', label: 'Security pools', route: 'security-pools' },
	{ hash: '#/open-oracle', label: 'OpenOracle', route: 'open-oracle' },
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
	const { trackRendered } = installDomTestLifecycle({
		beforeTest: () => {
			installTestRouting()
		},
		url: 'http://localhost/#/zoltar?universe=7&zoltarView=create&simulate=1',
	})

	test('renders the user-facing application section labels', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps()))
		trackRendered(rendered)

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('navigation', { name: 'Application sections' })).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: 'Deploy' }).getAttribute('href')).toBe('#/deploy?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Zoltar' }).getAttribute('href')).toBe('#/zoltar?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Zoltar' }).getAttribute('aria-current')).toBe('page')
		expect(documentQueries.getByRole('link', { name: 'Security pools' }).getAttribute('href')).toBe('#/security-pools?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'OpenOracle' }).getAttribute('href')).toBe('#/open-oracle?universe=7&simulate=1')
		expect(documentQueries.queryByRole('combobox')).toBeNull()
		expect(documentQueries.queryByRole('link', { name: 'Protocol guide' })).toBeNull()
	})

	test('omits an empty navigation landmark when only one application section is available', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps({ tabs: [{ hash: '#/zoltar', label: 'Questions', route: 'zoltar' }] })))
		trackRendered(rendered)

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
		trackRendered(rendered)

		const documentQueries = within(document.body)
		// The closed menu hides the current section's link, so the trigger names it and carries the current marker.
		const moreButton = documentQueries.getByRole('button', { name: 'More: Help' })
		expect(moreButton.getAttribute('aria-expanded')).toBe('false')
		expect(moreButton.getAttribute('aria-current')).toBe('true')
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

	test('marks no section current when the route is unknown', async () => {
		const moreTabs: RouteTabDefinition[] = [{ hash: '#/help', label: 'Help', route: 'help' }]
		const rendered = await renderIntoDocument(h(TabNavigation, createProps({ moreTabs, route: 'not-found' })))
		trackRendered(rendered)

		const navigation = within(document.body).getByRole('navigation', { name: 'Application sections' })
		expect(navigation.querySelectorAll('[aria-current]').length).toBe(0)
		expect(navigation.querySelectorAll('.active').length).toBe(0)
		expect(within(navigation).getByRole('button', { name: 'More' }).getAttribute('aria-current')).toBeNull()
	})

	test('names every section a shared reason disables when other sections stay available', async () => {
		const disabledReason = 'Deploy the required contracts first'
		const tabs = DEFAULT_TABS.map(tab => (tab.route === 'deploy' ? tab : { ...tab, disabled: true, disabledReason }))
		const rendered = await renderIntoDocument(h(TabNavigationUnavailableReasons, { tabs }))
		trackRendered(rendered)

		const reasons = document.body.querySelectorAll('.tab-nav-unavailable .disabled-reason')
		expect(Array.from(reasons, reason => reason.textContent)).toEqual([`Zoltar, Security pools, and OpenOracle: ${disabledReason}`])
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
		trackRendered(rendered)

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
		trackRendered(rendered)

		const reasons = document.body.querySelectorAll('.tab-nav-unavailable .disabled-reason')
		expect(reasons.length).toBe(1)
		expect(reasons[0]?.textContent).toBe(disabledReason)
	})

	test('keeps shared and destination-owned query state in top-level tab hrefs', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps()))
		trackRendered(rendered)

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('link', { name: 'Deploy' }).getAttribute('href')).toBe('#/deploy?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Zoltar' }).getAttribute('href')).toBe('#/zoltar?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'Security pools' }).getAttribute('href')).toBe('#/security-pools?universe=7&simulate=1')
		expect(documentQueries.getByRole('link', { name: 'OpenOracle' }).getAttribute('href')).toBe('#/open-oracle?universe=7&simulate=1')
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
		trackRendered(rendered)

		const securityPoolsLink = within(document.body).getByRole('link', { name: 'Security pools' })
		const locationBeforeClicks = window.location.href
		const preventNativeNavigation = (event: Event) => event.preventDefault()
		document.body.addEventListener('click', preventNativeNavigation)
		for (const clickInit of [{ altKey: true }, { button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) fireEvent.click(securityPoolsLink, clickInit)

		expect(routeChanges).toEqual([])
		expect(window.location.href).toBe(locationBeforeClicks)
		document.body.removeEventListener('click', preventNativeNavigation)
	})

	test('draws the keyboard focus ring after every navigation tab rule that clears it', () => {
		const cssSource = readCoreSharedCssSource()
		const focusSelector = '.header-toolbar-navigation .view-tabs.route .view-tab:focus-visible,'
		const focusRuleIndex = cssSource.indexOf(focusSelector)
		expect(focusRuleIndex).toBeGreaterThanOrEqual(0)
		expect(cssSource.indexOf('box-shadow: inset 0 0 0 2px var(--accent);', focusRuleIndex)).toBeLessThan(cssSource.indexOf('}', focusRuleIndex))
		// Inactive and active top-bar, bottom-bar, More, and section view tabs all reset box-shadow; the ring must come later to win ties.
		for (const resetSelector of [
			'.header-toolbar-navigation .view-tabs.route .view-tab,',
			'.header-toolbar-navigation .view-tabs.route .view-tab.active,',
			'.header-toolbar-navigation .tab-nav-more-trigger.view-tab.active {',
			'.view-tabs[data-orientation="horizontal"]:is(.route, .subroute) .view-tab {',
			'.route-subtab-nav.view-tabs.subroute .view-tab {',
		])
			expect(cssSource.lastIndexOf(resetSelector)).toBeLessThan(focusRuleIndex)
	})
})

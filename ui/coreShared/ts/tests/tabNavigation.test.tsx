/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { TabNavigation } from '../components/TabNavigation.js'
import type { RouteTabDefinition } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { fireEvent, within } from './testUtils/queries'
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
		expect(documentQueries.getByRole('combobox', { name: 'Current application section' })).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: 'Protocol Guide' }).getAttribute('href')).toBe('https://augurproject.github.io/zoltar/docs/documentation.html')
	})

	test('changes routes from the compact route selector', async () => {
		const routeChanges: string[] = []
		const rendered = await renderIntoDocument(
			h(
				TabNavigation,
				createProps({
					onRouteChange: route => routeChanges.push(route),
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup

		fireEvent.change(within(document.body).getByRole('combobox', { name: 'Current application section' }), { target: { value: 'security-pools' } })

		expect(routeChanges).toEqual(['security-pools'])
	})

	test('omits route controls when only one application section is available', async () => {
		const rendered = await renderIntoDocument(
			h(
				TabNavigation,
				createProps({
					tabs: [{ hash: '#/zoltar', label: 'Questions', route: 'zoltar' }],
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('link', { name: 'Questions' })).toBeNull()
		expect(documentQueries.queryByRole('combobox', { name: 'Current application section' })).toBeNull()
		expect(documentQueries.getByRole('link', { name: 'Protocol Guide' })).not.toBeNull()
	})

	test('omits the shared protocol guide when the application does not own that documentation', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps({ showProtocolGuide: false })))
		cleanupRenderedComponent = rendered.cleanup

		expect(within(document.body).queryByRole('link', { name: 'Protocol Guide' })).toBeNull()
	})

	test('omits an empty navigation landmark when no route chooser or guide is available', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps({ showProtocolGuide: false, tabs: [{ hash: '#/zoltar', label: 'Questions', route: 'zoltar' }] })))
		cleanupRenderedComponent = rendered.cleanup

		expect(within(document.body).queryByRole('navigation', { name: 'Application sections' })).toBeNull()
	})

	test('keeps the first tab as the current compact route when the route is unknown', async () => {
		const rendered = await renderIntoDocument(h(TabNavigation, createProps({ route: 'not-found' })))
		cleanupRenderedComponent = rendered.cleanup

		const routeSelector = within(document.body).getByRole('combobox', { name: 'Current application section' })
		if (!(routeSelector instanceof window.HTMLSelectElement)) throw new Error('Expected compact route selector')
		expect(routeSelector.value).toBe('deploy')
		expect(routeSelector.selectedOptions[0]?.textContent).toBe('Deploy')
	})

	test('uses the disabled reason copy for disabled application sections', async () => {
		const disabledReason = 'Deploy the application contracts before using this section.'
		const routeChanges: string[] = []
		const rendered = await renderIntoDocument(
			h(
				TabNavigation,
				createProps({
					onRouteChange: route => {
						routeChanges.push(route)
					},
					tabs: DEFAULT_TABS.map(tab => (tab.route === 'zoltar' ? { ...tab, disabled: true, disabledReason } : tab)),
				}),
			),
		)
		cleanupRenderedComponent = rendered.cleanup

		const documentQueries = within(document.body)
		const zoltarTab = documentQueries.getByRole('link', { name: 'Zoltar' }) as HTMLAnchorElement
		expect(zoltarTab.getAttribute('aria-disabled')).toBe('true')
		expect(zoltarTab.getAttribute('href')).toBeNull()
		expect(zoltarTab.tabIndex).toBe(0)
		expect(zoltarTab.title).toBe(disabledReason)
		expect(zoltarTab.getAttribute('aria-description')).toBe(disabledReason)
		expect(documentQueries.getByText(disabledReason, { selector: '.mobile-route-select .disabled-reason' })).toBeDefined()

		zoltarTab.focus()
		expect(document.activeElement).toBe(zoltarTab)
		fireEvent.click(zoltarTab)
		expect(routeChanges).toEqual([])
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

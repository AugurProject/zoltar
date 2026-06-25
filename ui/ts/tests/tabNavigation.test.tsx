/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { TabNavigation } from '../components/TabNavigation.js'
import type { TabNavigationProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createProps(overrides: Partial<TabNavigationProps> = {}): TabNavigationProps {
	return {
		augurPlaceHolderDeployed: true,
		deployRoute: '#/deploy',
		marketRoute: '#/zoltar',
		onRouteChange: () => undefined,
		openOracleRoute: '#/open-oracle',
		route: 'zoltar',
		securityPoolsRoute: '#/security-pools',
		showDeployTab: true,
		...overrides,
	}
}

describe('TabNavigation', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders the user-facing application section labels', async () => {
		const renderedComponent = await renderIntoDocument(<TabNavigation {...createProps()} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('tablist', { name: 'Application sections' })).not.toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Deploy' }).getAttribute('href')).toBe('#/deploy')
		expect(documentQueries.getByRole('tab', { name: 'Markets' }).getAttribute('href')).toBe('#/zoltar')
		expect(documentQueries.getByRole('tab', { name: 'Security Pools' }).getAttribute('href')).toBe('#/security-pools')
		expect(documentQueries.getByRole('tab', { name: 'Oracle Reports' }).getAttribute('href')).toBe('#/open-oracle')
		expect(documentQueries.queryByRole('tab', { name: 'Zoltar' })).toBeNull()
		expect(documentQueries.queryByRole('tab', { name: 'Open Oracle' })).toBeNull()
	})

	test('uses the deployment prerequisite copy for disabled application sections', async () => {
		const routeChanges: string[] = []
		const renderedComponent = await renderIntoDocument(
			<TabNavigation
				{...createProps({
					augurPlaceHolderDeployed: false,
					onRouteChange: route => {
						routeChanges.push(route)
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const marketsTab = within(document.body).getByRole('tab', { name: 'Markets' }) as HTMLButtonElement
		expect(marketsTab.disabled).toBe(true)
		expect(marketsTab.title).toBe('Deploy the application contracts before using this section.')
		expect(marketsTab.getAttribute('aria-description')).toBe('Deploy the application contracts before using this section.')

		fireEvent.click(marketsTab)
		expect(routeChanges).toEqual([])
	})
})

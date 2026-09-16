/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createSecondaryNavigation, resolveSecondaryNavigation, withDeploymentTab } from '../../navigation/appNavigation.js'

const deploymentTab = { hash: '#/deploy', label: 'Deploy', route: 'deploy' }
const primaryTabs = [
	{ hash: '#/security-pools', label: 'Security Pools', route: 'security-pools' },
	{ hash: '#/open-oracle', label: 'Open Oracle', route: 'open-oracle' },
]

describe('app navigation', () => {
	test('lists the deployment tab only while deployment is incomplete or the deployment route is open', () => {
		expect(withDeploymentTab({ deploymentTab, deploymentIncomplete: false, route: 'security-pools', tabs: primaryTabs }).map(tab => tab.route)).toEqual(['security-pools', 'open-oracle'])
		expect(withDeploymentTab({ deploymentTab, deploymentIncomplete: true, route: 'security-pools', tabs: primaryTabs }).map(tab => tab.route)).toEqual(['deploy', 'security-pools', 'open-oracle'])
		expect(withDeploymentTab({ deploymentTab, deploymentIncomplete: false, route: 'deploy', tabs: primaryTabs }).map(tab => tab.route)).toEqual(['deploy', 'security-pools', 'open-oracle'])
	})

	test('resolves secondary views only for the route that owns them', () => {
		const securityPoolViews = createSecondaryNavigation({ ariaLabel: 'Security Pools views', onChange: () => undefined, options: [{ label: 'Browse Pools', value: 'browse' }], value: 'browse' })
		const secondaryByRoute = { 'security-pools': securityPoolViews }
		expect(resolveSecondaryNavigation({ route: 'security-pools', secondaryByRoute })).toBe(securityPoolViews)
		expect(resolveSecondaryNavigation({ route: 'deploy', secondaryByRoute })).toBeUndefined()
		expect(resolveSecondaryNavigation({ route: 'open-oracle', secondaryByRoute })).toBeUndefined()
		expect(resolveSecondaryNavigation({ route: 'not-found', secondaryByRoute })).toBeUndefined()
	})

	test('forwards only known view values to the typed change handler', () => {
		const changes: Array<'browse' | 'create'> = []
		const navigation = createSecondaryNavigation<'browse' | 'create'>({
			ariaLabel: 'Security Pools views',
			onChange: value => changes.push(value),
			options: [
				{ label: 'Browse Pools', value: 'browse' },
				{ label: 'Create Pool', value: 'create' },
			],
			value: 'browse',
		})
		navigation.onChange('create')
		navigation.onChange('unknown')
		expect(changes).toEqual(['create'])
	})
})

import { describe, expect, test } from 'bun:test'
import { tradingNavigationTabs } from '../../lib/tradingNavigation.js'

const pool = '0x1111111111111111111111111111111111111111'

describe('trading navigation', () => {
	test('keeps three trader tabs in the bar, secondary sections under More, and never disables a destination while a transaction is pending', () => {
		const navigation = tradingNavigationTabs({ addressedPool: undefined, displayedRoute: 'market', liveDeploymentStatus: 'verified' })
		expect(navigation.tabs.map(tab => tab.label)).toEqual(['Markets', 'Portfolio', 'Create'])
		expect(navigation.moreTabs.map(tab => tab.label)).toEqual(['Liquidity', 'Universe', 'Help'])
		expect([...navigation.tabs, ...navigation.moreTabs].some(tab => tab.disabled === true)).toBe(false)
	})

	test('keeps the addressed pool in market and liquidity links', () => {
		const navigation = tradingNavigationTabs({ addressedPool: pool, displayedRoute: 'market', liveDeploymentStatus: 'verified' })
		expect(navigation.tabs.find(tab => tab.route === 'market')?.hash).toBe(`#/market/${pool}`)
		expect(navigation.moreTabs.find(tab => tab.route === 'liquidity')?.hash).toBe(`#/liquidity/${pool}`)
	})

	test('leads with the deployment tab only while contracts are missing or the deployment route is open', () => {
		for (const liveDeploymentStatus of ['loading', 'verified', 'unreachable'] as const) expect(tradingNavigationTabs({ addressedPool: undefined, displayedRoute: 'market', liveDeploymentStatus }).tabs.map(tab => tab.route)).toEqual(['market', 'portfolio', 'create-market'])
		expect(tradingNavigationTabs({ addressedPool: undefined, displayedRoute: 'deploy', liveDeploymentStatus: 'missing' }).tabs.map(tab => tab.route)).toEqual(['deploy', 'market', 'portfolio', 'create-market'])
		expect(tradingNavigationTabs({ addressedPool: undefined, displayedRoute: 'deploy', liveDeploymentStatus: 'verified' }).tabs[0]?.route).toBe('deploy')
	})
})

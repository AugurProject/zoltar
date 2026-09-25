import { expect, mock, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { getRouteSecondaryNavigation, getStatoblastRouteTabs, getTransactionRouteKey } from '../../app/lib/appNavigation.js'

installDomTestLifecycle({ url: 'http://localhost/#/pools?universe=7' })

test('shows one primary row with Portfolio, Pools, and Open Oracle under Advanced', () => {
	const tabs = getStatoblastRouteTabs({ route: 'pools', showDeployTab: false })
	expect(tabs.map(tab => tab.route)).toEqual(['portfolio', 'pools', 'open-oracle'])
	expect(tabs.map(tab => tab.label)).toEqual(['Portfolio', 'Pools', 'Advanced'])
	expect(tabs.map(tab => tab.hash)).toEqual(['#/portfolio', '#/pools', '#/open-oracle'])
})

test('keeps deployment reachable while needed and while its route is active', () => {
	expect(getStatoblastRouteTabs({ route: 'pools', showDeployTab: true })[0]?.route).toBe('deploy')
	expect(getStatoblastRouteTabs({ route: 'deploy', showDeployTab: false })[0]?.route).toBe('deploy')
})

test('lists pool views as paths without a Manage Pool peer and preserves the universe', () => {
	const setSecurityPoolsView = mock(() => undefined)
	const navigation = getRouteSecondaryNavigation({ activeOpenOracleView: 'browse', activeSecurityPoolsView: 'browse', route: 'pools', setOpenOracleView: () => undefined, setSecurityPoolsView })
	if (navigation === undefined) throw new Error('Expected secondary navigation')
	expect(navigation.options.map(option => option.value)).toEqual(['browse', 'create', 'universes'])
	expect(navigation.options.map(option => option.href)).toEqual(['#/pools?universe=7', '#/pools/create?universe=7', '#/pools/universes?universe=7'])
	navigation.onChange('create')
	navigation.onChange('operate')
	expect(setSecurityPoolsView).toHaveBeenCalledTimes(1)
	expect(setSecurityPoolsView).toHaveBeenCalledWith('create')
})

test('hides the list views on a pool page', () => {
	expect(getRouteSecondaryNavigation({ activeOpenOracleView: 'browse', activeSecurityPoolsView: 'operate', route: 'pools', setOpenOracleView: () => undefined, setSecurityPoolsView: () => undefined })).toBeUndefined()
})

test('routes Open Oracle view changes to their owner and preserves universe links', () => {
	const setOpenOracleView = mock(() => undefined)
	const setSecurityPoolsView = mock(() => undefined)
	const navigation = getRouteSecondaryNavigation({ activeOpenOracleView: 'browse', activeSecurityPoolsView: 'browse', route: 'open-oracle', setOpenOracleView, setSecurityPoolsView })
	if (navigation === undefined) throw new Error('Expected secondary navigation')
	navigation.onChange('create')
	navigation.onChange('invalid')
	expect(setOpenOracleView).toHaveBeenCalledTimes(1)
	expect(setOpenOracleView).toHaveBeenCalledWith('create')
	expect(setSecurityPoolsView).not.toHaveBeenCalled()
	for (const option of navigation.options) {
		expect(option.href).toStartWith('#/open-oracle?')
		const query = new URLSearchParams(option.href?.split('?')[1])
		expect(query.get('universe')).toBe('7')
		expect(query.get('openOracleView')).toBe(option.value)
	}
})

test('uses the route and active view to isolate transaction presentation', () => {
	const views = { activeOpenOracleView: 'selected-report', activeSecurityPoolsView: 'operate' } as const
	expect(getTransactionRouteKey({ ...views, route: 'pools' })).toBe('pools:operate')
	expect(getTransactionRouteKey({ ...views, route: 'open-oracle' })).toBe('open-oracle:selected-report')
	expect(getTransactionRouteKey({ ...views, route: 'portfolio' })).toBe('portfolio')
	expect(getRouteSecondaryNavigation({ ...views, route: 'not-found', setOpenOracleView: () => undefined, setSecurityPoolsView: () => undefined })).toBeUndefined()
})

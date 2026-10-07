import { expect, mock, test } from 'bun:test'
import { statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { getRouteSecondaryNavigation, getStatoblastRouteTabs, getTransactionRouteKey } from '../../app/lib/appNavigation.js'

installDomTestLifecycle({ url: 'http://localhost/#/pools?universe=7' })

test('shows one primary row with Pools and OpenOracle', () => {
	const tabs = getStatoblastRouteTabs({ applicationDeploymentMissing: false, route: 'pools', showDeployTab: false })
	expect(tabs.map(tab => tab.route)).toEqual(['pools', 'open-oracle'])
	expect(tabs.map(tab => tab.label)).toEqual(['Pools', 'OpenOracle'])
	expect(tabs.map(tab => tab.hash)).toEqual(['#/pools', '#/open-oracle'])
})

test('keeps deployment reachable while needed and while its route is active', () => {
	expect(getStatoblastRouteTabs({ applicationDeploymentMissing: false, route: 'pools', showDeployTab: true })[0]?.route).toBe('deploy')
	expect(getStatoblastRouteTabs({ applicationDeploymentMissing: false, route: 'deploy', showDeployTab: false })[0]?.route).toBe('deploy')
})

test('disables the other sections with a reason while required contracts are missing', () => {
	const tabs = getStatoblastRouteTabs({ applicationDeploymentMissing: true, route: 'deploy', showDeployTab: true })
	expect(tabs.map(tab => [tab.route, tab.disabled === true, tab.disabledReason])).toEqual([
		['deploy', false, undefined],
		['pools', true, 'Deploy the required contracts first'],
		['open-oracle', true, 'Deploy the required contracts first'],
	])
	expect(getStatoblastRouteTabs({ applicationDeploymentMissing: false, route: 'deploy', showDeployTab: true }).some(tab => tab.disabled === true)).toBe(false)
})

test('lists pool views as paths without a Manage Pool peer and preserves the universe', () => {
	const setSecurityPoolsView = mock(() => undefined)
	const navigation = getRouteSecondaryNavigation({ activeOpenOracleView: 'browse', activeSecurityPoolsView: 'browse', route: 'pools', setOpenOracleView: () => undefined, setSecurityPoolsView })
	if (navigation === undefined) throw new Error('Expected secondary navigation')
	// Browse search opens a pasted pool address, so there is no separate Open pool view.
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

test('routes OpenOracle view changes to their owner and preserves universe links', () => {
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
	expect(getTransactionRouteKey({ ...views, route: 'deploy' })).toBe('deploy')
	expect(getRouteSecondaryNavigation({ ...views, route: 'not-found', setOpenOracleView: () => undefined, setSecurityPoolsView: () => undefined })).toBeUndefined()
})

test('lands on Browse pools by default and rejects the removed portfolio route', () => {
	expect(statoblastRouting.resolve('')).toBe('pools')
	expect(statoblastRouting.getHash('pools')).toBe('#/pools')
	expect(statoblastRouting.resolve('#/pools/browse')).toBe('pools')
	expect(statoblastRouting.resolve('#/portfolio')).toBe('not-found')
})

test('treats a malformed pools path as not found instead of falling back to Browse pools', () => {
	for (const routeHash of ['#/pools/browse/x', '#/pools/create/extra', '#/pools/operate', '#/pools/0xabc/tab/extra']) expect(statoblastRouting.resolve(routeHash)).toBe('not-found')
	expect(statoblastRouting.resolve('#/pools/0xa83562266e1514927697d5118C8777828860aD73/vaults')).toBe('pools')
})

test('keeps the active migration screen in navigation with the same universe', () => {
	const navigation = getRouteSecondaryNavigation({ activeOpenOracleView: 'browse', activeSecurityPoolsView: 'migrate', route: 'pools', setOpenOracleView: () => undefined, setSecurityPoolsView: () => undefined })
	expect(navigation?.value).toBe('migrate')
	expect(navigation?.options.find(option => option.value === 'migrate')?.href).toBe('#/pools/migrate?universe=7')
	expect(getTransactionRouteKey({ activeOpenOracleView: 'browse', activeSecurityPoolsView: 'migrate', route: 'pools' })).toBe('pools:migrate')
})

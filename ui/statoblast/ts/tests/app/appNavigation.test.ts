import { expect, mock, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { getRouteSecondaryNavigation, getStatoblastRouteTabs, getTransactionRouteKey } from '../../app/lib/appNavigation.js'

installDomTestLifecycle({ url: 'http://localhost/#/security-pools?universe=7&securityPoolsView=browse' })

test('keeps deployment reachable while needed and while its route is active', () => {
	expect(getStatoblastRouteTabs({ route: 'security-pools', showDeployTab: false }).map(tab => tab.route)).toEqual(['security-pools', 'open-oracle'])
	expect(getStatoblastRouteTabs({ route: 'security-pools', showDeployTab: true })[0]?.route).toBe('deploy')
	expect(getStatoblastRouteTabs({ route: 'deploy', showDeployTab: false })[0]?.route).toBe('deploy')
})

test.each(['security-pools', 'open-oracle'])('routes %s view changes to their owner and preserves universe links', route => {
	const setOpenOracleView = mock(() => undefined)
	const setSecurityPoolsView = mock(() => undefined)
	const navigation = getRouteSecondaryNavigation({ activeOpenOracleView: 'browse', activeSecurityPoolsView: 'browse', route, setOpenOracleView, setSecurityPoolsView })
	if (navigation === undefined) throw new Error('Expected secondary navigation')
	navigation.onChange('create')
	navigation.onChange('invalid')
	const owner = route === 'security-pools' ? setSecurityPoolsView : setOpenOracleView
	const other = route === 'security-pools' ? setOpenOracleView : setSecurityPoolsView
	expect(owner).toHaveBeenCalledTimes(1)
	expect(owner).toHaveBeenCalledWith('create')
	expect(other).not.toHaveBeenCalled()
	for (const option of navigation.options) {
		expect(option.href).toStartWith(`#/${route}?`)
		const query = new URLSearchParams(option.href?.split('?')[1])
		expect(query.get('universe')).toBe('7')
		expect(query.get(route === 'security-pools' ? 'securityPoolsView' : 'openOracleView')).toBe(option.value)
	}
})

test('uses the route and active view to isolate transaction presentation', () => {
	const views = { activeOpenOracleView: 'selected-report', activeSecurityPoolsView: 'operate' } as const
	expect(getTransactionRouteKey({ ...views, route: 'security-pools' })).toBe('security-pools:operate')
	expect(getTransactionRouteKey({ ...views, route: 'open-oracle' })).toBe('open-oracle:selected-report')
	expect(getTransactionRouteKey({ ...views, route: 'deploy' })).toBe('deploy')
	expect(getRouteSecondaryNavigation({ ...views, route: 'not-found', setOpenOracleView: () => undefined, setSecurityPoolsView: () => undefined })).toBeUndefined()
})

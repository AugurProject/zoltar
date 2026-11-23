import { expect, mock, test } from 'bun:test'
import { statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { getRouteSecondaryNavigation, getStatoblastRouteTabs, getTransactionRouteKey } from '../../app/lib/appNavigation.js'

installDomTestLifecycle({ url: 'http://localhost/#/pools?universe=7' })

test('shows one primary row with Pools, Security pools and Price reports', () => {
	const tabs = getStatoblastRouteTabs({ applicationDeploymentMissing: false, route: 'pools', showDeployTab: false })
	expect(tabs.map(tab => tab.route)).toEqual(['pools', 'securityPools', 'open-oracle'])
	expect(tabs.map(tab => tab.label)).toEqual(['Questions', 'SecurityPools', 'Price reports'])
	expect(tabs.map(tab => tab.hash)).toEqual(['#/pools', '#/securityPools', '#/open-oracle'])
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
		['securityPools', true, 'Deploy the required contracts first'],
		['open-oracle', true, 'Deploy the required contracts first'],
	])
	expect(getStatoblastRouteTabs({ applicationDeploymentMissing: false, route: 'deploy', showDeployTab: true }).some(tab => tab.disabled === true)).toBe(false)
})

test('lists pool views as paths without a Manage Pool peer and preserves the universe', () => {
	const setQuestionLedgersView = mock(() => undefined)
	const navigation = getRouteSecondaryNavigation({ activeQuestionLedgersView: 'browse', route: 'pools', setQuestionLedgersView })
	if (navigation === undefined) throw new Error('Expected secondary navigation')
	// Browse search opens a pasted pool address, so there is no separate Open pool view.
	expect(navigation.options.map(option => option.value)).toEqual(['browse', 'universes'])
	expect(navigation.options.map(option => option.href)).toEqual(['#/pools?universe=7', '#/pools/universes?universe=7'])
	navigation.onChange('universes')
	navigation.onChange('operate')
	expect(setQuestionLedgersView).toHaveBeenCalledTimes(1)
	expect(setQuestionLedgersView).toHaveBeenCalledWith('universes')
})

test('hides the list views on a pool page', () => {
	expect(getRouteSecondaryNavigation({ activeQuestionLedgersView: 'operate', route: 'pools', setQuestionLedgersView: () => undefined })).toBeUndefined()
})

test('price requests expose no standalone report navigation', () => {
	expect(getRouteSecondaryNavigation({ activeQuestionLedgersView: 'browse', route: 'open-oracle', setQuestionLedgersView: () => undefined })).toBeUndefined()
	expect(getTransactionRouteKey({ activeQuestionLedgersView: 'browse', route: 'open-oracle' })).toBe('open-oracle')
})

test('lands on Browse pools by default and rejects the removed security pool route', () => {
	expect(statoblastRouting.resolve('')).toBe('pools')
	expect(statoblastRouting.getHash('pools')).toBe('#/pools')
	expect(statoblastRouting.resolve('#/pools/browse')).toBe('pools')
	expect(statoblastRouting.resolve('#/securityPool')).toBe('not-found')
	expect(statoblastRouting.resolve('#/securityPools')).toBe('securityPools')
})

test('treats a malformed pools path as not found instead of falling back to Browse pools', () => {
	for (const routeHash of ['#/pools/browse/x', '#/pools/create/extra', '#/pools/operate', '#/pools/0xabc/tab/extra']) expect(statoblastRouting.resolve(routeHash)).toBe('not-found')
	expect(statoblastRouting.resolve('#/pools/0xa83562266e1514927697d5118C8777828860aD73/vaults')).toBe('not-found')
})

test('keeps the active migration screen in navigation with the same universe', () => {
	const navigation = getRouteSecondaryNavigation({ activeQuestionLedgersView: 'migrate', route: 'pools', setQuestionLedgersView: () => undefined })
	expect(navigation?.value).toBe('migrate')
	expect(navigation?.options.find(option => option.value === 'migrate')?.href).toBe('#/pools/migrate?universe=7')
	expect(getTransactionRouteKey({ activeQuestionLedgersView: 'migrate', route: 'pools' })).toBe('pools:migrate')
})

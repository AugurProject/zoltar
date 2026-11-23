import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getRouteHref, resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { buildQuestionPoolHref, installStatoblastRouting, statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { getInvalidStatoblastRouteState, isInvalidStatoblastRouteState } from '../../app/lib/routeValidation.js'

let cleanup: (() => void) | undefined
beforeEach(() => {
	cleanup = installDomEnvironment('http://localhost/').cleanup
	installStatoblastRouting()
})
afterEach(() => {
	cleanup?.()
	resetRoutingForTesting()
})

test('preserves the selected pool through Advanced navigation and refresh', () => {
	const pool = '0x1111111111111111111111111111111111111111'
	window.history.replaceState({}, '', `#/pools/${pool}?universe=7`)
	const advanced = getRouteHref('open-oracle')
	expect(advanced).toBe(`#/open-oracle?universe=7&questionLedger=${pool}`)
	window.history.replaceState({}, '', advanced)
	installStatoblastRouting()
	expect(getRouteHref('pools')).toBe(`#/pools/${pool}?universe=7`)
	window.history.replaceState({}, '', '#/pools?universe=7')
	expect(getRouteHref('open-oracle')).toBe('#/open-oracle?universe=7&poolsView=browse')
})

test('a security pool purchase links to its question pool page inside the same simulation', () => {
	const pool = '0x3333333333333333333333333333333333333333'
	window.history.replaceState({}, '', `#/securityPools?simulate=1&genesis=yes&simScenario=securitypoolx2&securityPool=${pool}&owner=${pool}`)
	const href = buildQuestionPoolHref(pool)
	expect(href).toBe(`#/pools/${pool}?simulate=1&genesis=yes&simScenario=securitypoolx2`)
	window.history.replaceState({}, '', href)
	expect(isInvalidStatoblastRouteState(getInvalidStatoblastRouteState({ pageSearch: '', resolvedRoute: 'pools', search: '?simulate=1&genesis=yes&simScenario=securitypoolx2' }))).toBe(false)
})

test('does not remember incomplete pool addresses or invent a pool tab', () => {
	window.history.replaceState({}, '', '#/pools/0x123?universe=7')
	expect(getRouteHref('open-oracle')).toBe('#/open-oracle?universe=7')
	const pool = '0x2222222222222222222222222222222222222222'
	window.history.replaceState({}, '', `#/pools/${pool}`)
	expect(getRouteHref('open-oracle')).toBe(`#/open-oracle?questionLedger=${pool}`)
	window.history.replaceState({}, '', `#/open-oracle?questionLedger=${pool}&openOracleReportId=42`)
	expect(getRouteHref('pools')).toBe(`#/pools/${pool}?openOracleReportId=42`)
})

test('keeps Advanced report, browser controls, vault context and universe across primary routes', () => {
	const pool = '0x1111111111111111111111111111111111111111'
	const vault = '0x2222222222222222222222222222222222222222'
	window.history.replaceState({}, '', `#/open-oracle?universe=7&questionLedger=${pool}&vault=${vault}&vaultView=vault-by-address&openOracleReportId=42&openOracleView=selected-report&poolSearch=hello&poolFilter=ended&poolSort=endTime`)
	const pools = getRouteHref('pools')
	const params = new URLSearchParams(pools.split('?')[1])
	expect(params.has('openOracleView')).toBe(false)
	for (const [key, value] of new URLSearchParams(window.location.hash.split('?')[1])) {
		if (key === 'questionLedger' || key === 'selectedPoolView' || key === 'openOracleView') continue
		expect(params.get(key)).toBe(value)
	}
	window.history.replaceState({}, '', pools)
	expect(new URLSearchParams(getRouteHref('open-oracle').split('?')[1]).get('openOracleReportId')).toBe('42')
})

test('returns to Browse or Universes with the same list controls and selected universe', () => {
	for (const [path, view] of [
		['#/pools', 'browse'],
		['#/pools/universes', 'universes'],
	]) {
		window.history.replaceState({}, '', path + '?universe=7&poolSearch=hello')
		const advanced = getRouteHref('open-oracle')
		expect(advanced).toContain('poolsView=' + view)
		window.history.replaceState({}, '', advanced)
		expect(getRouteHref('pools')).toBe(path + '?universe=7&poolSearch=hello')
	}
})

test('uses the Favorites browser when no pool context was selected', () => {
	window.history.replaceState({}, '', '#/open-oracle')
	expect(getRouteHref('pools')).toBe('#/pools')
})

test('opens Security pools with the price report return context and drops removed oracle views', () => {
	for (const openOracleView of ['create', 'selected-report']) {
		window.history.replaceState({}, '', `#/open-oracle?openOracleView=${openOracleView}&openOracleReportId=42&universe=7`)
		const href = getRouteHref('securityPools')
		const search = href.split('?')[1] ?? ''
		const resolvedRoute = statoblastRouting.resolve(href)
		expect(resolvedRoute).toBe('securityPools')
		expect(new URLSearchParams(search).has('openOracleView')).toBe(false)
		expect(isInvalidStatoblastRouteState(getInvalidStatoblastRouteState({ pageSearch: '', resolvedRoute, search }))).toBe(false)
		window.history.replaceState({}, '', href)
		expect(getRouteHref('open-oracle')).toBe('#/open-oracle?openOracleReportId=42&universe=7')
	}
})

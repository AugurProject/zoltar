import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getRouteHref, resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'

let cleanup: (() => void) | undefined
beforeEach(() => {
	cleanup = installDomEnvironment('http://localhost/').cleanup
	installStatoblastRouting()
})
afterEach(() => {
	cleanup?.()
	resetRoutingForTesting()
})

test('preserves the selected pool and tab through Advanced navigation and refresh', () => {
	const pool = '0x1111111111111111111111111111111111111111'
	window.history.replaceState({}, '', `#/pools/${pool}/vaults?universe=7`)
	const advanced = getRouteHref('open-oracle')
	expect(advanced).toBe(`#/open-oracle?universe=7&securityPool=${pool}&selectedPoolView=vaults`)
	window.history.replaceState({}, '', advanced)
	installStatoblastRouting()
	expect(getRouteHref('pools')).toBe(`#/pools/${pool}/vaults?universe=7`)
	window.history.replaceState({}, '', '#/pools?universe=7')
	expect(getRouteHref('open-oracle')).toBe('#/open-oracle?universe=7&poolsView=browse')
})

test('does not remember incomplete pool addresses or invent a pool tab', () => {
	window.history.replaceState({}, '', '#/pools/0x123?universe=7')
	expect(getRouteHref('open-oracle')).toBe('#/open-oracle?universe=7')
	const pool = '0x2222222222222222222222222222222222222222'
	window.history.replaceState({}, '', `#/pools/${pool}`)
	expect(getRouteHref('open-oracle')).toBe(`#/open-oracle?securityPool=${pool}`)
	window.history.replaceState({}, '', `#/open-oracle?securityPool=${pool}&openOracleReportId=42`)
	expect(getRouteHref('pools')).toBe(`#/pools/${pool}?openOracleReportId=42`)
})

test('keeps Advanced report, browser controls, vault context and universe across primary routes', () => {
	const pool = '0x1111111111111111111111111111111111111111'
	const vault = '0x2222222222222222222222222222222222222222'
	window.history.replaceState({}, '', `#/open-oracle?universe=7&securityPool=${pool}&selectedPoolView=vaults&vault=${vault}&vaultView=vault-by-address&openOracleReportId=42&openOracleView=selected-report&poolSearch=hello&poolFilter=ended&poolSort=endTime`)
	const pools = getRouteHref('pools')
	const params = new URLSearchParams(pools.split('?')[1])
	for (const [key, value] of new URLSearchParams(window.location.hash.split('?')[1])) {
		if (key === 'securityPool' || key === 'selectedPoolView') continue
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

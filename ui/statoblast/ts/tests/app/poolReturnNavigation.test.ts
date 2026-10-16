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
	expect(getRouteHref('open-oracle')).toBe('#/open-oracle?universe=7')
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

test('keeps Advanced report, vault context and universe across primary routes', () => {
	const pool = '0x1111111111111111111111111111111111111111'
	const vault = '0x2222222222222222222222222222222222222222'
	window.history.replaceState({}, '', `#/open-oracle?universe=7&securityPool=${pool}&selectedPoolView=vaults&vault=${vault}&vaultView=vault-by-address&openOracleReportId=42&openOracleView=selected-report`)
	const pools = getRouteHref('pools')
	const params = new URLSearchParams(pools.split('?')[1])
	for (const [key, value] of new URLSearchParams(window.location.hash.split('?')[1])) {
		if (key === 'securityPool' || key === 'selectedPoolView') continue
		expect(params.get(key)).toBe(value)
	}
	window.history.replaceState({}, '', pools)
	expect(new URLSearchParams(getRouteHref('open-oracle').split('?')[1]).get('openOracleReportId')).toBe('42')
})

test('keeps the pool list controls out of Advanced and Deploy links and returns to the same list view and controls', () => {
	for (const path of ['#/pools', '#/pools/universes']) {
		window.history.replaceState({}, '', path + '?universe=7&poolSearch=hello&poolSort=endTime&poolFilter=ended')
		expect(getRouteHref('deploy')).toBe('#/deploy?universe=7')
		const advanced = getRouteHref('open-oracle')
		expect(advanced).toBe('#/open-oracle?universe=7')
		window.history.replaceState({}, '', advanced)
		expect(getRouteHref('pools')).toBe(path + '?universe=7&poolSearch=hello&poolSort=endTime&poolFilter=ended')
	}
})

test('opens Browse without stale list controls after a reload on Advanced', () => {
	window.history.replaceState({}, '', '#/pools/universes?universe=7&poolSearch=hello')
	window.history.replaceState({}, '', getRouteHref('open-oracle'))
	installStatoblastRouting()
	expect(getRouteHref('pools')).toBe('#/pools?universe=7')
})

test('uses the Favorites browser when no pool context was selected', () => {
	window.history.replaceState({}, '', '#/open-oracle')
	expect(getRouteHref('pools')).toBe('#/pools')
})

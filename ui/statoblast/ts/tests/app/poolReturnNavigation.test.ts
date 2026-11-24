import { expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { buildQuestionPoolHref, installStatoblastRouting, parseStatoblastPage, statoblastPageHref } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'

const pool = getAddress('0x1111111111111111111111111111111111111111')
installDomTestLifecycle({ afterTest: resetRoutingForTesting })

test('pool and question links preserve the network, universe, and simulation settings', () => {
	installStatoblastRouting()
	window.history.replaceState({}, '', `#/pool/${pool}/questions?simulate=1&genesis=yes&simScenario=securitypoolx2&universe=7`)
	const href = buildQuestionPoolHref(pool, 4n)
	expect(href).toBe(`#/pool/${pool}/question/0x4/shares?simulate=1&genesis=yes&simScenario=securitypoolx2&universe=7`)
	const page = parseStatoblastPage(href)
	if (page.kind !== 'question') throw new Error('Expected question link.')
	expect(statoblastPageHref({ kind: 'pool', pool: page.pool, tab: 'capital' }, 9n)).toBe(`#/pool/${pool}?simulate=1&genesis=yes&simScenario=securitypoolx2&universe=9`)
	const positionHref = statoblastPageHref({ kind: 'pool', pool, tab: 'liquidations', positionId: 7n }, 9n)
	expect(positionHref).toBe(`#/pool/${pool}/liquidations?simulate=1&genesis=yes&simScenario=securitypoolx2&universe=9&position=7`)
	expect(parseStatoblastPage(positionHref)).toEqual({ kind: 'pool', pool, tab: 'liquidations', positionId: 7n })
})

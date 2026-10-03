import { describe, expect, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { getStatoblastOverviewUniverse } from '../../app/lib/overviewUniverse.js'

const unforkedUniverse = { forkTime: 0n, hasForked: false, totalTheoreticalSupplyAttoRep: 11_000_000n * 10n ** 18n }

describe('Statoblast top bar universe', () => {
	installDomTestLifecycle({
		url: 'http://localhost/#/pools/create?universe=7',
		beforeTest: installStatoblastRouting,
		afterTest: resetRoutingForTesting,
	})

	test('shows the connected account REP balance, not the universe REP supply', () => {
		const overview = getStatoblastOverviewUniverse({ loadingZoltarForkAccess: false, zoltarForkRepBalanceAttoRep: 12n * 10n ** 18n, zoltarUniverse: unforkedUniverse })
		expect(overview.universeRepBalanceAttoRep).toBe(12n * 10n ** 18n)
	})

	test('leaves the REP balance unknown until the account balance loads', () => {
		const overview = getStatoblastOverviewUniverse({ loadingZoltarForkAccess: true, zoltarForkRepBalanceAttoRep: undefined, zoltarUniverse: unforkedUniverse })
		expect(overview.universeRepBalanceAttoRep).toBeUndefined()
		expect(overview.isLoadingUniverseRepBalance).toBe(true)
	})

	test('omits the migration link on the active migration screen', () => {
		const overview = getStatoblastOverviewUniverse({ migrationActive: true, loadingZoltarForkAccess: false, zoltarForkRepBalanceAttoRep: undefined, zoltarUniverse: { forkTime: 5n, hasForked: true } })
		expect(overview.migrateRepHref).toBeUndefined()
		expect(overview.universeHasForked).toBe(true)
	})

	test('links a forked universe notice to REP migration in the current universe', () => {
		const overview = getStatoblastOverviewUniverse({ loadingZoltarForkAccess: false, zoltarForkRepBalanceAttoRep: undefined, zoltarUniverse: { forkTime: 5n, hasForked: true } })
		expect(overview.universeHasForked).toBe(true)
		expect(overview.universeForkTime).toBe(5n)
		expect(overview.migrateRepHref).toBe('#/pools/migrate?universe=7')
	})
})

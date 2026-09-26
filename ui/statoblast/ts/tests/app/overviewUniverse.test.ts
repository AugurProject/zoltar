import { describe, expect, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { getStatoblastOverviewUniverse } from '../../app/lib/overviewUniverse.js'

const unforkedUniverse = { forkTime: 0n, hasForked: false, totalTheoreticalSupplyAttoRep: 11_000_000n * 10n ** 18n }

describe('Statoblast top bar universe', () => {
	installDomTestLifecycle({ url: 'http://localhost/#/security-pools?universe=7' })

	test('shows the connected account REP balance, not the universe REP supply', () => {
		const overview = getStatoblastOverviewUniverse({ loadingZoltarForkAccess: false, zoltarForkRepBalanceAttoRep: 12n * 10n ** 18n, zoltarUniverse: unforkedUniverse })
		expect(overview.universeRepBalanceAttoRep).toBe(12n * 10n ** 18n)
	})

	test('leaves the REP balance unknown until the account balance loads', () => {
		const overview = getStatoblastOverviewUniverse({ loadingZoltarForkAccess: true, zoltarForkRepBalanceAttoRep: undefined, zoltarUniverse: unforkedUniverse })
		expect(overview.universeRepBalanceAttoRep).toBeUndefined()
		expect(overview.isLoadingUniverseRepBalance).toBe(true)
	})

	test('links a forked universe notice to the universe directory in the current universe', () => {
		const overview = getStatoblastOverviewUniverse({ loadingZoltarForkAccess: false, zoltarForkRepBalanceAttoRep: undefined, zoltarUniverse: { forkTime: 5n, hasForked: true } })
		expect(overview.universeHasForked).toBe(true)
		expect(overview.universeForkTime).toBe(5n)
		expect(overview.migrateRepHref).toBe('#/security-pools?universe=7&securityPoolsView=universes')
	})
})

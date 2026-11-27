import { describe, expect, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { installStatoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { getStatoblastUniversePresentation } from '../../app/lib/overviewUniverse.js'

const unforkedUniverse = { forkTime: 0n, hasForked: false, totalTheoreticalSupplyAttoRep: 11_000_000n * 10n ** 18n }

describe('Statoblast top bar universe', () => {
	installDomTestLifecycle({
		url: 'http://localhost/#/watchlist?universe=7',
		beforeTest: installStatoblastRouting,
		afterTest: resetRoutingForTesting,
	})

	test('shows the not-found hint for a universe link that names no deployed universe', () => {
		expect(getStatoblastUniversePresentation({ canReadOnchainData: true, loadingZoltarUniverse: false, zoltarUniverse: undefined, zoltarUniverseMissing: true })).toMatchObject({ key: 'not_found', detail: 'This universe has not been created yet.' })
		expect(getStatoblastUniversePresentation({ canReadOnchainData: true, loadingZoltarUniverse: true, zoltarUniverse: undefined, zoltarUniverseMissing: false })).toBeUndefined()
		expect(getStatoblastUniversePresentation({ canReadOnchainData: false, loadingZoltarUniverse: false, zoltarUniverse: undefined, zoltarUniverseMissing: true })).toBeUndefined()
		expect(getStatoblastUniversePresentation({ canReadOnchainData: true, loadingZoltarUniverse: false, zoltarUniverse: unforkedUniverse, zoltarUniverseMissing: false })).toBeUndefined()
	})
})

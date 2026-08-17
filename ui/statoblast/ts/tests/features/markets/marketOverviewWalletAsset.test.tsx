/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { MarketOverviewSection } from '../../../features/markets/components/MarketOverviewSection.js'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createInjectedBackend } from '@zoltar/ui-core-shared/lib/chainBackend.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

const TOKEN_ADDRESS = '0x00000000000000000000000000000000000000a1'

describe('MarketOverviewSection wallet asset control', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreActiveEnvironment: (() => void) | undefined
	let restoreDomEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		Reflect.set(domEnvironment.window, 'ethereum', {
			request: async () => true,
		})
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createInjectedBackend())
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('adds the current universe REP token control to the overview', async () => {
		const universe = {
			childUniverses: [],
			forkThresholdAttoRep: 100n,
			forkQuestionDetails: undefined,
			forkTime: 0n,
			forkingOutcomeIndex: 0n,
			hasForked: false,
			parentUniverseId: 0n,
			reputationToken: TOKEN_ADDRESS,
			totalTheoreticalSupplyAttoRep: 1_000n,
			universeId: 0n,
		} satisfies ZoltarUniverseSummary
		const renderedComponent = await renderIntoDocument(
			<MarketOverviewSection accountAddress={zeroAddress} isOnActiveAppChain loadingZoltarUniverse={false} onCreateChildUniverseForOutcomeIndex={() => undefined} zoltarChildUniverseError={undefined} zoltarChildUniversePendingOutcomeIndex={undefined} zoltarUniverse={universe} zoltarUniverseState='ready' />,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByRole('button', { name: 'Add Genesis (0x0) REP to wallet' })).not.toBeNull()
	})
})

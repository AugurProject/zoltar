/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { MarketOverviewSection } from '../../../features/markets/components/MarketOverviewSection.js'
import { installActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { createInjectedBackend } from '../../../lib/chainBackend.js'
import type { ZoltarUniverseSummary } from '../../../types/contracts.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { within } from '../../testUtils/queries.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'

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

	test('does not repeat the header REP token control in the market overview', async () => {
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

		expect(within(document.body).queryByRole('button', { name: 'Add Genesis (0x0) REP to wallet' })).toBeNull()
	})
})

/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { UniverseDirectorySection } from '../../../features/universes/components/UniverseDirectorySection.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [
			{ exists: true, forkTime: 1n, outcomeIndex: 0n, outcomeLabel: 'Yes', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 2n },
			{ exists: false, forkTime: 1n, outcomeIndex: 1n, outcomeLabel: 'No', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 3n },
		],
		forkQuestionDetails: undefined,
		forkThresholdAttoRep: 1n,
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 1n,
		universeId: 1n,
		...overrides,
	}
}

installTestRouting()
describe('UniverseDirectorySection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('shows selection actions only for deployed non-active child universes', async () => {
		const renderedComponent = await renderIntoDocument(h(UniverseDirectorySection, { activeUniverseId: 1n, zoltarUniverse: createUniverse() }))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const selectLinks = documentQueries.getAllByRole('link', { name: 'Select' })
		expect(selectLinks).toHaveLength(1)
		expect(selectLinks[0]?.textContent).toBe('Select')
		expect(selectLinks[0]?.className).toContain('button-link')
	})
})

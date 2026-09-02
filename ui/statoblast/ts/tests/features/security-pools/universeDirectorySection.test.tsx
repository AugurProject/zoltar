/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { zeroAddress, type Address } from '@zoltar/shared/ethereum'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { UniverseDirectorySection } from '../../../features/security-pools/components/UniverseDirectorySection.js'
import type { ListedSecurityPool, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

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

function createSecurityPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return {
		currentRetentionRate: 10n,
		feeEligibleCapacityOwnershipAttoRep: 1n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: false,
		hasForkContinuationEscalationGame: false,
		hasLoadedVaults: true,
		initialReportPriorityFeeAttoEthPerGas: 1n,
		lastOraclePrice: 1n,
		lastOracleSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		marketDetails: {
			answerUnit: '',
			createdAt: 1n,
			description: 'Question description',
			displayValueMax: 100n,
			displayValueMin: 0n,
			endTime: 2n,
			exists: true,
			marketType: 'binary',
			numTicks: 2n,
			outcomeLabels: ['Yes', 'No'],
			questionId: '0x01',
			startTime: 1n,
			title: 'Will this resolve?',
		},
		migratedAttoRep: 0n,
		ordinaryEscalationGameStarted: false,
		parent: zeroAddress,
		questionId: '0x01',
		questionOutcome: 'none',
		securityPoolAddress: '0x0000000000000000000000000000000000000001' as Address,
		settlementCollateralAttoEth: 0n,
		shareTokenSupplyAttoShares: 0n,
		statoblastSecurityMultiplierBps: 20_000n,
		systemState: 'operational',
		totalCapacityOwnershipAttoRep: 2n * 10n ** 18n,
		totalPoolHeldAttoRep: 3n * 10n ** 18n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		vaultCount: 2n,
		vaults: [],
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
		const renderedComponent = await renderIntoDocument(h(UniverseDirectorySection, { activeUniverseId: 1n, securityPools: [], zoltarUniverse: createUniverse() }))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const selectLinks = documentQueries.getAllByRole('link', { name: 'Select' })
		expect(selectLinks).toHaveLength(1)
		expect(selectLinks[0]?.className).toContain('button-link')
	})

	test('keeps a parent universe link available when the active universe is a child', async () => {
		const renderedComponent = await renderIntoDocument(
			h(UniverseDirectorySection, {
				activeUniverseId: 2n,
				securityPools: [],
				zoltarUniverse: createUniverse({
					childUniverses: [],
					parentUniverseId: 1n,
					universeId: 2n,
				}),
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const parentLink = within(document.body).getByRole('link', { name: 'Universe 0x1' })
		expect(parentLink.getAttribute('href')).toContain('universe=1')
	})

	test('shows statoblast pool metrics for the active and child universes', async () => {
		const renderedComponent = await renderIntoDocument(
			h(UniverseDirectorySection, {
				activeUniverseId: 1n,
				securityPools: [
					createSecurityPool(),
					createSecurityPool({
						securityPoolAddress: '0x0000000000000000000000000000000000000002' as Address,
						totalPoolHeldAttoRep: 5n * 10n ** 18n,
						universeId: 2n,
						vaultCount: 4n,
					}),
				],
				zoltarUniverse: createUniverse(),
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Security Pools')).not.toBeNull()
		expect(document.body.textContent).toContain('Pool-held REP')
		expect(document.body.textContent).toContain('Known Vaults')
		expect(document.body.textContent).toContain('3.00 REP')
		expect(document.body.textContent).toContain('5.00 REP')
	})

	test('shows loading and retry states while universe stats are loading or fail', async () => {
		const loadingRender = await renderIntoDocument(h(UniverseDirectorySection, { activeUniverseId: 1n, loadingSecurityPools: true, securityPools: undefined, zoltarUniverse: createUniverse() }))
		cleanupRenderedComponent = loadingRender.cleanup
		expect(document.body.textContent).toContain('Loading')
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		let retried = false
		const errorRender = await renderIntoDocument(
			h(UniverseDirectorySection, {
				activeUniverseId: 1n,
				onRetry: () => {
					retried = true
				},
				securityPoolError: 'Failed to load universe stats',
				securityPools: undefined,
				zoltarUniverse: createUniverse(),
			}),
		)
		cleanupRenderedComponent = errorRender.cleanup

		const retryButton = within(document.body).getByRole('button', { name: 'Retry' })
		retryButton.click()
		expect(retried).toBe(true)
	})
})

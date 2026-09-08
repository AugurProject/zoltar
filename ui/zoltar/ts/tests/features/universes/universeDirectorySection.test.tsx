/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { zeroAddress } from '@zoltar/shared/evm/ethereum'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { UniverseDirectorySection } from '@zoltar/ui-zoltar-shared/features/universes/components/UniverseDirectorySection.js'
import { ZoltarSection } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/components/ZoltarSection.js'
import type { MarketRouteContentProps } from '@zoltar/ui-zoltar-shared/features/types.js'
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

	test('links deployed universe IDs and offers deployment for missing children', async () => {
		const renderedComponent = await renderIntoDocument(h(UniverseDirectorySection, { activeUniverseId: 1n, accountAddress: zeroAddress, isOnActiveAppChain: true, onDeployChildUniverse: () => undefined, pendingOutcomeIndex: undefined, zoltarUniverse: createUniverse() }))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('link', { name: 'Select' })).toBeNull()
		expect(documentQueries.getAllByRole('link').some(link => link.textContent?.includes('Universe'))).toBe(true)
		expect(documentQueries.getByRole('button', { name: 'Deploy universe' })).toBeTruthy()
	})

	for (const hasForked of [false, true]) {
		test(`renders ${hasForked ? 'migration' : 'fork'} actions in the Universe view`, async () => {
			const props: MarketRouteContentProps = {
				accountState: { address: zeroAddress, chainId: '0x1', ethBalanceAttoEth: 0n, wethBalanceAttoEth: 0n },
				activeUniverseId: 1n,
				activeView: 'universes',
				environmentRefreshKey: 0,
				zoltarUniverseState: 'ready',
				questionForm: { answerUnit: '', categoricalOutcomes: [], description: '', scalarIncrement: '', scalarMax: '', scalarMin: '', title: '', endTime: '', marketType: 'binary', startTime: '' },
				zoltarForkApproval: { error: undefined, loading: false, value: 0n },
				zoltarForkQuestionId: '',
				zoltarMigrationForm: { amount: '', outcomeIndexes: '' },
				zoltarMigrationChildRepBalancesAttoRep: {},
				zoltarMigrationChildSplitAmountsAttoRep: {},
				zoltarQuestions: [],
				zoltarUniverse: createUniverse({ hasForked }),
				onApproveZoltarForkRep: () => undefined,
				onCreateChildUniverseForOutcomeIndex: () => undefined,
				onForkZoltar: () => undefined,
				onMigrateInternalRep: () => undefined,
				onRetryMigrationBalances: () => undefined,
				onActiveViewChange: () => undefined,
				loadingZoltarQuestionCount: false,
				loadingZoltarQuestion: false,
				loadingZoltarQuestions: false,
				hasLoadedZoltarQuestions: false,
				zoltarForkActiveAction: undefined,
				loadingZoltarUniverse: false,
				onLoadZoltarQuestions: async () => undefined,
				onLoadZoltarQuestion: async () => undefined,
				onLoadZoltarQuestionPage: async () => undefined,
				onCreateQuestion: () => undefined,
				onQuestionFormChange: () => undefined,
				onResetQuestion: () => undefined,
				onZoltarMigrationFormChange: () => undefined,
				zoltarQuestionCount: undefined,
				zoltarQuestionLookupError: undefined,
				zoltarQuestionLookupId: undefined,
				zoltarQuestionPage: undefined,
				questionCreating: false,
				questionError: undefined,
				questionResult: undefined,
				zoltarForkError: undefined,
				loadingZoltarForkAccess: false,
				zoltarChildUniverseError: undefined,
				zoltarChildUniversePendingOutcomeIndex: undefined,
				zoltarForkPending: false,
				zoltarForkRepBalanceAttoRep: undefined,
				zoltarMigrationError: undefined,
				zoltarMigrationPending: false,
				zoltarMigrationPreparedRepBalanceAttoRep: undefined,
				zoltarQuestionsError: undefined,
				zoltarMigrationActiveAction: undefined,
				onZoltarForkQuestionIdChange: () => undefined,
			}
			const rendered = await renderIntoDocument(h(ZoltarSection, props))
			cleanupRenderedComponent = rendered.cleanup
			const queries = within(document.body)
			expect(queries.getByRole('heading', { name: 'Universe' })).toBeTruthy()
			if (hasForked) {
				expect(document.body.textContent?.indexOf('Migrate REP')).toBeLessThan(document.body.textContent?.indexOf('Child Universes') ?? 0)
				expect(queries.getByRole('button', { name: 'Split REP' })).toBeTruthy()
				expect(queries.queryByRole('button', { name: 'Fork Universe' })).toBeNull()
			} else {
				expect(queries.getByRole('button', { name: 'Fork Universe' })).toBeTruthy()
				expect(queries.queryByRole('button', { name: 'Prepare REP' })).toBeNull()
			}
		})
	}
})

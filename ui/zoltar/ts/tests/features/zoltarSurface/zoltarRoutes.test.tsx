/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ZoltarView } from '@zoltar/ui-zoltar-shared/features/types.js'
import { ZoltarRoutes } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/components/ZoltarRoutes.js'
import { ZoltarWorkspaceProvider } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/components/ZoltarWorkspace.js'
import { describe, expect, test } from 'bun:test'

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [
			{ exists: true, forkTime: 0n, outcomeIndex: 0n, outcomeLabel: 'Yes', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 2n },
			{ exists: false, forkTime: 0n, outcomeIndex: 1n, outcomeLabel: 'No', parentUniverseId: 1n, reputationToken: zeroAddress, universeId: 3n },
		],
		forkQuestionDetails: undefined,
		forkThresholdAttoRep: 1n,
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		lineage: [
			{ outcomeLabel: undefined, universeId: 0n },
			{ outcomeLabel: 'Alpha', universeId: 1n },
		],
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 1n,
		universeId: 1n,
		...overrides,
	}
}

/** The operation slice the Zoltar route containers read; each test overrides the universe and view. */
function createOperations(universe: ZoltarUniverseSummary | undefined) {
	return {
		approveZoltarForkRep: async () => undefined,
		createChildUniverse: async () => undefined,
		createQuestion: async () => undefined,
		forkZoltar: async () => undefined,
		hasLoadedZoltarQuestions: false,
		loadZoltarForkAccess: async () => undefined,
		loadZoltarQuestion: async () => undefined,
		loadZoltarQuestionPage: async () => undefined,
		loadingZoltarForkAccess: false,
		loadingZoltarQuestion: false,
		loadingZoltarQuestions: false,
		loadingZoltarUniverse: false,
		migrateInternalRep: async () => undefined,
		questionCreating: false,
		questionError: undefined,
		questionForm: { answerUnit: '', categoricalOutcomes: [], description: '', endTime: '', marketType: 'binary', scalarIncrement: '', scalarMax: '', scalarMin: '', startTime: '', title: '' },
		questionResult: undefined,
		resetQuestion: () => undefined,
		setQuestionForm: () => undefined,
		setZoltarForkQuestionId: () => undefined,
		setZoltarMigrationForm: () => undefined,
		zoltarChildUniverseError: undefined,
		zoltarChildUniversePendingOutcomeIndex: undefined,
		zoltarForkActiveAction: undefined,
		zoltarForkApproval: { error: undefined, loading: false, value: 0n },
		zoltarForkError: undefined,
		zoltarForkPending: false,
		zoltarForkQuestionId: '',
		zoltarForkRepBalanceAttoRep: 10n,
		zoltarMigrationActiveAction: undefined,
		zoltarMigrationChildRepBalancesAttoRep: {},
		zoltarMigrationChildSplitAmountsAttoRep: {},
		zoltarMigrationError: undefined,
		zoltarMigrationForm: { amount: '', outcomeIndexes: '' },
		zoltarMigrationPending: false,
		zoltarMigrationPreparedRepBalanceAttoRep: 0n,
		zoltarQuestionLookupError: undefined,
		zoltarQuestionLookupId: undefined,
		zoltarQuestionPage: { pageIndex: 0, pageSize: 10, questionCount: 0n, questions: [] },
		zoltarQuestions: [],
		zoltarQuestionsError: undefined,
		zoltarUniverse: universe,
	}
}

installTestRouting()
describe('ZoltarRoutes', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	async function renderRoute(view: ZoltarView, universe: ZoltarUniverseSummary | undefined, universeState: LoadableValueState = 'ready') {
		const viewChanges: ZoltarView[] = []
		const workspace = {
			accountState: { address: zeroAddress, chainId: '0xaa36a7', ethBalanceAttoEth: 0n, wethBalanceAttoEth: 0n },
			activeUniverseId: universe?.universeId ?? 9n,
			currentTimestamp: 10n,
			environmentRefreshKey: 0,
			isConnectingWallet: false,
			onConnectWallet: () => undefined,
			onGoToGenesisUniverse: () => undefined,
			onSwitchNetwork: () => undefined,
			onViewChange: (nextView: ZoltarView) => viewChanges.push(nextView),
			operations: createOperations(universe),
			universeState,
		}
		cleanupRenderedComponent = (
			await renderIntoDocument(
				<ZoltarWorkspaceProvider workspace={workspace}>
					<ZoltarRoutes view={view} />
				</ZoltarWorkspaceProvider>,
			)
		).cleanup
		return { queries: within(document.body), viewChanges }
	}

	test('shows Fork, not Migrate, in the Universes browser of an unforked universe', async () => {
		const { queries, viewChanges } = await renderRoute('universes', createUniverse({ childUniverses: [], hasForked: false }))
		expect(queries.getByRole('heading', { name: 'Universes' })).toBeTruthy()
		expect(queries.queryByRole('button', { name: 'Migrate REP' })).toBeNull()
		fireEvent.click(queries.getByRole('button', { name: 'Fork Universe' }))
		expect(viewChanges).toEqual(['fork'])
		expect(queries.queryByRole('textbox')).toBeNull()
	})

	test('shows Migrate, not Fork, in the Universes browser of a forked universe', async () => {
		const { queries, viewChanges } = await renderRoute('universes', createUniverse())
		expect(queries.queryByRole('button', { name: 'Fork Universe' })).toBeNull()
		fireEvent.click(queries.getByRole('button', { name: 'Migrate REP' }))
		expect(viewChanges).toEqual(['migrate'])
		expect(queries.getByText('Yes')).toBeTruthy()
		expect(queries.queryByRole('button', { name: 'Split REP' })).toBeNull()
	})

	test('mounts the fork workflow on the Fork route of an unforked universe', async () => {
		const { queries } = await renderRoute('fork', createUniverse({ childUniverses: [], hasForked: false }))
		expect(queries.getByRole('button', { name: 'Fork Universe' })).toBeTruthy()
		expect(queries.getByRole('button', { name: 'Approve REP' })).toBeTruthy()
	})

	test('mounts the migration workflow on the Migrate route of a forked universe', async () => {
		const { queries } = await renderRoute('migrate', createUniverse())
		expect(queries.getByRole('heading', { name: 'Choose destinations' })).toBeTruthy()
		expect(queries.getByRole('button', { name: 'Deploy universe' })).toBeTruthy()
		expect(queries.getByRole('button', { name: 'Split REP' })).toBeTruthy()
	})

	test('redirects a Fork route on a forked universe to migration', async () => {
		const { queries, viewChanges } = await renderRoute('fork', createUniverse())
		expect(queries.getByText('Already forked')).toBeTruthy()
		fireEvent.click(queries.getByRole('button', { name: 'Migrate REP' }))
		expect(viewChanges).toEqual(['migrate'])
	})

	test('explains that migration waits for a fork', async () => {
		const { queries, viewChanges } = await renderRoute('migrate', createUniverse({ childUniverses: [], hasForked: false }))
		expect(queries.getByText('No fork yet')).toBeTruthy()
		expect(queries.queryByRole('button', { name: 'Split REP' })).toBeNull()
		fireEvent.click(queries.getByRole('button', { name: 'Browse universes' }))
		expect(viewChanges).toEqual(['universes'])
	})

	test('shows an explicit not-found state with a Genesis link for a missing universe', async () => {
		for (const view of ['universes', 'fork', 'migrate'] as const) {
			const { queries } = await renderRoute(view, undefined, 'missing')
			expect(queries.getByText('Universe not found')).toBeTruthy()
			expect(queries.getByRole('link', { name: 'Go to Genesis universe' }).getAttribute('href')).toContain('universe=0')
			expect(queries.queryByText('Questions')).toBeNull()
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		}
	})

	test('keeps the global question list available for a missing universe', async () => {
		const { queries } = await renderRoute('questions', undefined, 'missing')
		expect(queries.queryByText('Universe not found')).toBeNull()
		expect(queries.getByRole('heading', { name: 'Browse Questions' })).toBeTruthy()
	})

	test('leads the Overview with the user status and exactly one next step', async () => {
		const { queries, viewChanges } = await renderRoute('overview', createUniverse())
		expect(queries.getByRole('heading', { name: 'Overview' })).toBeTruthy()
		expect(queries.getByText('Genesis › Alpha')).toBeTruthy()
		expect(queries.getByText('Migrate your REP')).toBeTruthy()
		const nextStep = document.body.querySelector('.zoltar-next-step')
		if (!(nextStep instanceof HTMLElement)) throw new Error('Expected the next step')
		const actions = within(nextStep).getAllByRole('button')
		expect(actions).toHaveLength(1)
		fireEvent.click(within(nextStep).getByRole('button', { name: 'Migrate REP' }))
		expect(viewChanges).toEqual(['migrate'])
		expect(document.body.querySelectorAll('.zoltar-model-steps li')).toHaveLength(3)
	})
})

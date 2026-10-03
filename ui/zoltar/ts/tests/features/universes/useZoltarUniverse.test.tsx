/// <reference types='bun-types' />

import { createPublicClient, createWalletClient, publicActions, getAddress, http, zeroAddress, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { createUniverseSummary } from '@zoltar/ui-core-shared/tests/testUtils/universeFixtures.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { getActiveBackend, installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { DeploymentStatus, MarketDetails, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { useZoltarUniverse, type UseZoltarUniverseDependencies } from '@zoltar/ui-zoltar-shared/features/universes/hooks/useZoltarUniverse.js'
import { appBlockWatcher } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'

type UseZoltarUniverseState = ReturnType<typeof useZoltarUniverse>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')
const TEST_HASH: Hash = '0x0000000000000000000000000000000000000000000000000000000000000001'

// Reports exactly one new block to the shared watcher, whatever block earlier tests left as its latest.
function announceNewBlock() {
	const latest = appBlockWatcher.getLatestBlockNumber()
	if (latest === undefined) appBlockWatcher.reportBlock(1n)
	appBlockWatcher.reportBlock((latest ?? 1n) + 1n)
}

function createZoltarDeploymentStatus(): DeploymentStatus {
	return {
		address: zeroAddress,
		dependencies: [],
		deploy: async () => TEST_HASH,
		deployed: true,
		id: 'zoltar',
		label: 'Zoltar',
	}
}

function createQuestion(questionId: string): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 2n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId,
		startTime: 1n,
		title: `Question ${questionId}`,
	}
}

function createZoltarUniverseDependencies(overrides: Partial<UseZoltarUniverseDependencies> = {}): UseZoltarUniverseDependencies {
	return {
		createConnectedReadClient: mock(() => createPublicClient({ transport: http('http://127.0.0.1:8545') })),
		createWalletWriteClient: () => {
			throw new Error('createWalletWriteClient should not be called in this test')
		},
		createZoltarChildUniverse: async () => {
			throw new Error('createZoltarChildUniverse should not be called in this test')
		},
		loadAllZoltarQuestions: async () => {
			throw new Error('loadAllZoltarQuestions should not be called in this test')
		},
		loadMarketDetails: async () => {
			throw new Error('loadMarketDetails should not be called in this test')
		},
		loadZoltarQuestionCount: async () => {
			throw new Error('loadZoltarQuestionCount should not be called in this test')
		},
		loadZoltarQuestionPage: async () => {
			throw new Error('loadZoltarQuestionPage should not be called in this test')
		},
		loadZoltarUniverseSummary: async () => {
			throw new Error('loadZoltarUniverseSummary should not be called in this test')
		},
		...overrides,
	}
}

describe('useZoltarUniverse', () => {
	const { trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: NEXT_WALLET_ADDRESS, installActiveEnvironment: installActiveEnvironmentForTesting })

	test('loads related universe details only for migration and discards a stale full read on return', async () => {
		const delayedFullRead = createDeferred<ZoltarUniverseSummary>()
		const scopes: boolean[] = []
		const overview = createUniverseSummary({ relatedUniversesLoaded: false })
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: async () => 0n,
			loadZoltarUniverseSummary: async (_client, _id, _address, options) => {
				const full = options?.includeRelatedUniverses ?? true
				scopes.push(full)
				return full ? await delayedFullRead.promise : overview
			},
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness({ includeRelatedUniverses }: { includeRelatedUniverses: boolean }) {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: true,
					includeRelatedUniverses,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const rendered = await renderIntoDocument(<Harness includeRelatedUniverses={false} />)
		trackCleanup(rendered.cleanup)
		await waitFor(() => expect(requireHookState(hookState).zoltarUniverse).toEqual(overview))
		await act(() => render(<Harness includeRelatedUniverses />, rendered.container))
		await waitFor(() => expect(scopes).toEqual([false, true]))
		expect(requireHookState(hookState).zoltarUniverse).toEqual(overview)
		await act(() => render(<Harness includeRelatedUniverses={false} />, rendered.container))
		await waitFor(() => expect(scopes).toEqual([false, true]))
		await act(async () => {
			delayedFullRead.resolve(createUniverseSummary({ relatedUniversesLoaded: true }))
			await delayedFullRead.promise
		})
		expect(requireHookState(hookState).zoltarUniverse).toEqual(overview)
	})

	test.each(['success', 'failure'] as const)('keeps deployment state through migration view toggles and applies %s feedback', async result => {
		const transaction = createDeferred<Awaited<ReturnType<UseZoltarUniverseDependencies['createZoltarChildUniverse']>>>()
		const universe = createUniverseSummary({ universeId: 1n, hasForked: true, relatedUniversesLoaded: true })
		const createZoltarChildUniverse = mock(async () => await transaction.promise)
		const onTransactionFinished = mock(() => undefined)
		const dependencies = createZoltarUniverseDependencies({
			createWalletWriteClient: () => createWalletClient({ account: NEXT_WALLET_ADDRESS, chain: getActiveBackend().profile.chain, transport: http('http://127.0.0.1:8545') }).extend(publicActions),
			createZoltarChildUniverse,
			loadZoltarUniverseSummary: async () => universe,
			loadZoltarQuestionCount: async () => 0n,
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness({ includeRelatedUniverses, activeUniverseId = 1n }: { includeRelatedUniverses: boolean; activeUniverseId?: bigint }) {
			hookState = useZoltarUniverse(
				{
					accountAddress: NEXT_WALLET_ADDRESS,
					activeUniverseId,
					autoLoadInitialData: true,
					includeRelatedUniverses,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const rendered = await renderIntoDocument(<Harness includeRelatedUniverses />)
		trackCleanup(rendered.cleanup)
		await waitFor(() => expect(requireHookState(hookState).zoltarUniverse).toEqual(universe))
		let write: Promise<void> | undefined
		await act(() => {
			write = requireHookState(hookState).createChildUniverse(1n)
		})
		await waitFor(() => expect(createZoltarChildUniverse).toHaveBeenCalledTimes(1))
		const pendingFeedback = requireHookState(hookState).zoltarChildUniverseFeedback
		for (const full of [false, true]) {
			await act(() => render(<Harness includeRelatedUniverses={full} />, rendered.container))
			expect(requireHookState(hookState).zoltarUniverse).toEqual(universe)
			expect(requireHookState(hookState).zoltarChildUniversePendingOutcomeIndex).toBe(1n)
			expect(requireHookState(hookState).zoltarChildUniverseFeedback).toEqual(pendingFeedback)
		}
		await act(async () => {
			if (result === 'success') transaction.resolve({ action: 'createChildUniverse', hash: TEST_HASH, outcomeIndex: 1n, universeId: 1n })
			else transaction.reject(new Error('RPC transaction failed'))
			await write
		})
		expect(requireHookState(hookState).zoltarChildUniversePendingOutcomeIndex).toBeUndefined()
		expect(requireHookState(hookState).zoltarChildUniverseFeedback?.status.title).toBe(result === 'success' ? 'Child universe deployed' : 'Child universe deployment failed')
		expect(onTransactionFinished).toHaveBeenCalledTimes(1)
		const feedback = requireHookState(hookState).zoltarChildUniverseFeedback
		await act(() => render(<Harness includeRelatedUniverses={false} />, rendered.container))
		expect(requireHookState(hookState).zoltarChildUniverseFeedback).toEqual(feedback)
		await act(() => render(<Harness includeRelatedUniverses={false} activeUniverseId={2n} />, rendered.container))
		expect(requireHookState(hookState).zoltarChildUniverseFeedback).toBeUndefined()
		expect(requireHookState(hookState).zoltarChildUniversePendingOutcomeIndex).toBeUndefined()
	})

	test.each(['view', 'universe', 'environment', 'deployment'] as const)('preserves child-universe errors only for a %s change', async change => {
		const universe = createUniverseSummary({ universeId: 1n, hasForked: true, relatedUniversesLoaded: true })
		let hookState: UseZoltarUniverseState | undefined
		const dependencies = createZoltarUniverseDependencies({ loadZoltarUniverseSummary: async () => universe })
		function Harness({ changed = false }: { changed?: boolean }) {
			hookState = useZoltarUniverse(
				{
					accountAddress: undefined,
					activeUniverseId: changed && change === 'universe' ? 2n : 1n,
					autoLoadInitialData: false,
					includeRelatedUniverses: !changed,
					deploymentStatuses: changed && change === 'deployment' ? [] : [createZoltarDeploymentStatus()],
					environmentRefreshKey: changed && change === 'environment' ? 1 : 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const rendered = await renderIntoDocument(<Harness />)
		trackCleanup(rendered.cleanup)
		await act(async () => {
			await requireHookState(hookState).loadZoltarUniverse()
			await requireHookState(hookState).createChildUniverse(1n)
		})
		const error = requireHookState(hookState).zoltarChildUniverseError
		expect(error).toBeDefined()
		await act(() => render(<Harness changed />, rendered.container))
		expect(requireHookState(hookState).zoltarChildUniverseError).toBe(change === 'view' ? error : undefined)
		expect(requireHookState(hookState).zoltarUniverse).toEqual(change === 'view' ? universe : undefined)
	})

	test('does not request a child-universe transaction when the active wallet account changed', async () => {
		const onTransactionRequested = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)
		let hookState: UseZoltarUniverseState | undefined
		const Harness = function ZoltarUniverseHarness() {
			hookState = useZoltarUniverse({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 1n,
				autoLoadInitialData: false,
				deploymentStatuses: [],
				environmentRefreshKey: 0,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).createChildUniverse(0n)
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(onTransactionFailed).not.toHaveBeenCalled()
		expect(requireHookState(hookState).zoltarChildUniverseFeedback?.status.detail).toBe('Wallet account changed. Review the action with the connected account and try again')
	})

	test('ignores stale question page results after the environment refresh key changes', async () => {
		const oldPage = createDeferred<{
			pageIndex: number
			pageSize: number
			questionCount: bigint
			questions: MarketDetails[]
		}>()
		const newPage = createDeferred<{ pageIndex: number; pageSize: number; questionCount: bigint; questions: MarketDetails[] }>()
		let pageRequests = 0
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: mock(async () => 1n),
			loadZoltarQuestionPage: mock(async () => await (++pageRequests === 1 ? oldPage.promise : newPage.promise)),
			loadZoltarUniverseSummary: mock(async () => ({
				childUniverses: [],
				forkQuestionDetails: undefined,
				forkThresholdAttoRep: 100n,
				forkTime: 0n,
				forkingOutcomeIndex: 0n,
				hasForked: false,
				parentUniverseId: 0n,
				reputationToken: zeroAddress,
				totalTheoreticalSupplyAttoRep: 1000n,
				universeId: 1n,
			})),
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness({ environmentRefreshKey }: { environmentRefreshKey: number }) {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: true,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, { environmentRefreshKey: 0 }))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			void requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		await act(() => {
			render(h(Harness, { environmentRefreshKey: 1 }), renderedComponent.container)
		})
		expect(requireHookState(hookState).loadingZoltarQuestions).toBe(true)
		await act(async () => {
			oldPage.resolve({
				pageIndex: 0,
				pageSize: 10,
				questionCount: 1n,
				questions: [createQuestion('0x01')],
			})
			await oldPage.promise
		})

		expect(requireHookState(hookState).zoltarQuestionPage).toBeUndefined()
		expect(requireHookState(hookState).zoltarQuestions).toEqual([])
		const refreshedPage = { pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [createQuestion('0x02')] }
		await act(async () => {
			newPage.resolve(refreshedPage)
			await newPage.promise
		})
		await waitFor(async () => {
			await act(async () => undefined)
			expect(requireHookState(hookState).zoltarQuestionPage).toEqual(refreshedPage)
		})
	})

	test('keeps the global question page when the selected universe changes', async () => {
		const page = { pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [createQuestion('0x01')] }
		const loadZoltarUniverseSummary = mock(async () => undefined)
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: async () => 1n,
			loadZoltarQuestionPage: async () => page,
			loadZoltarUniverseSummary,
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness({ activeUniverseId }: { activeUniverseId: bigint }) {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId,
					autoLoadInitialData: true,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness activeUniverseId={1n} />)
		trackCleanup(renderedComponent.cleanup)
		await waitFor(() => expect(loadZoltarUniverseSummary).toHaveBeenCalledTimes(1))
		await act(async () => await requireHookState(hookState).loadZoltarQuestionPage(0, 10))

		await act(async () => {
			render(<Harness activeUniverseId={2n} />, renderedComponent.container)
			await Promise.resolve()
		})
		await waitFor(() => expect(loadZoltarUniverseSummary).toHaveBeenCalledTimes(2))

		expect(requireHookState(hookState).zoltarQuestionPage).toEqual(page)
		expect(requireHookState(hookState).zoltarQuestions).toEqual(page.questions)
		expect(requireHookState(hookState).zoltarUniverseMissing).toBe(true)
	})

	test('loads and canonicalizes an exact existing question ID without loading the question list', async () => {
		const question = createQuestion('0x99')
		const loadMarketDetails = mock(async (_client, questionId: bigint) => {
			expect(questionId).toBe(0x99n)
			return question
		})
		const dependencies = createZoltarUniverseDependencies({ loadMarketDetails })
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestion('0x00099')
		})

		expect(loadMarketDetails).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).zoltarQuestions).toEqual([question])
		expect(requireHookState(hookState).zoltarQuestionLookupId).toBe('0x99')
		expect(requireHookState(hookState).zoltarQuestionLookupError).toBeUndefined()

		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestion(`0x1${'0'.repeat(64)}`)
		})
		expect(loadMarketDetails).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).zoltarQuestionLookupId).toBeUndefined()
		expect(requireHookState(hookState).zoltarQuestionLookupError).toBe('Enter a valid hexadecimal question ID.')
	})

	test('attributes loading and errors only to the current exact question request', async () => {
		const olderQuestion = createDeferred<MarketDetails>()
		const dependencies = createZoltarUniverseDependencies({
			loadMarketDetails: async (_client, questionId) => {
				if (questionId === 1n) return await olderQuestion.promise
				throw new Error('current question lookup failed')
			},
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness />)
		trackCleanup(renderedComponent.cleanup)

		let olderRequest: Promise<void> | undefined
		await act(async () => {
			olderRequest = requireHookState(hookState).loadZoltarQuestion('0x1')
			await Promise.resolve()
		})
		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestion('0x2')
		})

		expect(requireHookState(hookState).loadingZoltarQuestion).toBe(false)
		expect(requireHookState(hookState).zoltarQuestionLookupId).toBe('0x2')
		expect(requireHookState(hookState).zoltarQuestionLookupError).toBe('Failed to load question. Reason: current question lookup failed')

		await act(async () => {
			olderQuestion.resolve(createQuestion('0x1'))
			await olderRequest
		})
		expect(requireHookState(hookState).zoltarQuestions).toEqual([])
		expect(requireHookState(hookState).zoltarQuestionLookupError).toBe('Failed to load question. Reason: current question lookup failed')
	})

	test('invalidates an older exact question request when the current question is cached', async () => {
		const olderQuestion = createDeferred<MarketDetails>()
		const cachedQuestion = createQuestion('0x2')
		const loadMarketDetails = mock(async (_client, questionId: bigint) => (questionId === 1n ? await olderQuestion.promise : cachedQuestion))
		const dependencies = createZoltarUniverseDependencies({ loadMarketDetails })
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness />)
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestion('0x2')
		})
		let olderRequest: Promise<void> | undefined
		await act(async () => {
			olderRequest = requireHookState(hookState).loadZoltarQuestion('0x1')
			await Promise.resolve()
		})
		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestion('0x02')
		})

		expect(loadMarketDetails).toHaveBeenCalledTimes(2)
		expect(requireHookState(hookState).loadingZoltarQuestion).toBe(false)
		expect(requireHookState(hookState).zoltarQuestionLookupId).toBe('0x2')
		expect(requireHookState(hookState).zoltarQuestionLookupError).toBeUndefined()

		await act(async () => {
			olderQuestion.resolve(createQuestion('0x1'))
			await olderRequest
		})
		expect(requireHookState(hookState).zoltarQuestions).toEqual([cachedQuestion])
	})

	test('ignores an exact lookup failure after the full question list resolves the canonical ID', async () => {
		const exactQuestion = createDeferred<MarketDetails>()
		const listedQuestion = createQuestion('0x01')
		const dependencies = createZoltarUniverseDependencies({
			loadAllZoltarQuestions: async () => [listedQuestion],
			loadMarketDetails: async () => await exactQuestion.promise,
			loadZoltarQuestionCount: async () => 1n,
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness />)
		trackCleanup(renderedComponent.cleanup)

		let exactRequest: Promise<void> | undefined
		await act(async () => {
			exactRequest = requireHookState(hookState).loadZoltarQuestion('0x1')
			await Promise.resolve()
		})
		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestions()
		})
		await act(async () => {
			exactQuestion.reject(new Error('late exact lookup failure'))
			await exactRequest
		})

		expect(requireHookState(hookState).zoltarQuestions).toEqual([listedQuestion])
		expect(requireHookState(hookState).zoltarQuestionLookupError).toBeUndefined()
	})

	test('clears an exact lookup error when a later question page resolves the canonical ID', async () => {
		const exactQuestion = createDeferred<MarketDetails>()
		const pagedQuestion = createQuestion('0x0001')
		const dependencies = createZoltarUniverseDependencies({
			loadMarketDetails: async () => await exactQuestion.promise,
			loadZoltarQuestionCount: async () => 1n,
			loadZoltarQuestionPage: async () => ({ pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [pagedQuestion] }),
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness />)
		trackCleanup(renderedComponent.cleanup)

		let exactRequest: Promise<void> | undefined
		await act(async () => {
			exactRequest = requireHookState(hookState).loadZoltarQuestion('0x1')
			await Promise.resolve()
		})
		await act(async () => {
			exactQuestion.reject(new Error('exact lookup failed first'))
			await exactRequest
		})
		expect(requireHookState(hookState).zoltarQuestionLookupError).toBe('Failed to load question. Reason: exact lookup failed first')

		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})

		expect(requireHookState(hookState).zoltarQuestions).toEqual([pagedQuestion])
		expect(requireHookState(hookState).zoltarQuestionLookupError).toBeUndefined()
	})

	test('reports automatic universe and question-count load failures', async () => {
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: async () => {
				throw new Error('question count RPC failed')
			},
			loadZoltarUniverseSummary: async () => {
				throw new Error('universe RPC failed')
			},
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: true,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await waitFor(() => {
			expect(requireHookState(hookState).zoltarUniverseError).toBe('Failed to load Zoltar universe. Reason: universe RPC failed')
			expect(requireHookState(hookState).zoltarQuestionsError).toBe('Failed to load Zoltar question count. Reason: question count RPC failed')
		})
	})

	test('does not report a question-count error before Zoltar is deployed', async () => {
		const loadZoltarQuestionCount = mock(async () => {
			throw new Error('question count RPC failed')
		})
		const dependencies = createZoltarUniverseDependencies({ loadZoltarQuestionCount })
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 0n,
					autoLoadInitialData: true,
					deploymentStatuses: [],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		await act(async () => undefined)
		expect(loadZoltarQuestionCount).not.toHaveBeenCalled()
		expect(requireHookState(hookState).zoltarQuestionsError).toBeUndefined()
	})

	test('loads a requested question page when scenario deployment becomes ready', async () => {
		const page = { pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [createQuestion('0x01')] }
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: async () => 1n,
			loadZoltarQuestionPage: async () => page,
			loadZoltarUniverseSummary: async () => undefined,
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness({ deployed }: { deployed: boolean }) {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 0n,
					autoLoadInitialData: true,
					deploymentStatuses: deployed ? [createZoltarDeploymentStatus()] : [],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, { deployed: false }))
		trackCleanup(renderedComponent.cleanup)
		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		await act(async () => {
			render(h(Harness, { deployed: true }), renderedComponent.container)
		})
		await waitFor(async () => {
			await act(async () => undefined)
			expect(requireHookState(hookState).zoltarQuestionPage).toEqual(page)
		})
	})

	test('ignores a late question-count failure after Zoltar becomes undeployed', async () => {
		const questionCount = createDeferred<bigint>()
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: async () => await questionCount.promise,
			loadZoltarUniverseSummary: async () => undefined,
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness({ deployed }: { deployed: boolean }) {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 0n,
					autoLoadInitialData: true,
					deploymentStatuses: deployed ? [createZoltarDeploymentStatus()] : [],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, { deployed: true }))
		trackCleanup(renderedComponent.cleanup)

		await act(() => {
			render(h(Harness, { deployed: false }), renderedComponent.container)
		})
		await act(async () => {
			questionCount.reject(new Error('late question count failure'))
			await questionCount.promise.catch(() => undefined)
		})

		expect(requireHookState(hookState).zoltarQuestionsError).toBeUndefined()
		expect(requireHookState(hookState).zoltarQuestionCount).toBeUndefined()
	})

	test('ignores an older partial page failure after a newer page succeeds', async () => {
		const oldPage = createDeferred<{
			pageIndex: number
			pageSize: number
			questionCount: bigint
			questions: MarketDetails[]
		}>()
		let countCall = 0
		let pageCall = 0
		const newQuestion = createQuestion('0x02')
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: async () => {
				countCall += 1
				if (countCall === 1) throw new Error('old count failure')
				return 1n
			},
			loadZoltarQuestionPage: async () => {
				pageCall += 1
				if (pageCall === 1) return await oldPage.promise
				return { pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [newQuestion] }
			},
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)

		void requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		await waitFor(() => expect(countCall).toBe(1))
		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		await act(async () => {
			oldPage.resolve({ pageIndex: 0, pageSize: 10, questionCount: 0n, questions: [] })
			await oldPage.promise
		})

		expect(requireHookState(hookState).zoltarQuestionsError).toBeUndefined()
		expect(requireHookState(hookState).zoltarQuestionPage?.questions).toEqual([newQuestion])
	})

	test('refreshes the universe summary and question page in place on a new block so forks and new questions appear', async () => {
		const universe = { childUniverses: [], forkQuestionDetails: undefined, forkThresholdAttoRep: 100n, forkTime: 0n, forkingOutcomeIndex: 0n, hasForked: false, parentUniverseId: 0n, reputationToken: zeroAddress, totalTheoreticalSupplyAttoRep: 1000n, universeId: 1n }
		const forkedUniverse = { ...universe, forkTime: 50n, hasForked: true }
		const firstPage = { pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [createQuestion('0x01')] }
		const refreshedPage = { pageIndex: 0, pageSize: 10, questionCount: 2n, questions: [createQuestion('0x01'), createQuestion('0x02')] }
		const refreshedPageRead = createDeferred<typeof refreshedPage>()
		let universeReads = 0
		let pageReads = 0
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: mock(async () => 1n),
			loadZoltarQuestionPage: mock(async () => (++pageReads === 1 ? firstPage : await refreshedPageRead.promise)),
			loadZoltarUniverseSummary: mock(async () => (++universeReads === 1 ? universe : forkedUniverse)),
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: true,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 41,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)
		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		await waitFor(() => expect(requireHookState(hookState).zoltarUniverse?.hasForked).toBe(false))
		expect(requireHookState(hookState).zoltarQuestionPage).toEqual(firstPage)
		expect(requireHookState(hookState).zoltarUniverseFreshness.updatedAt).toBeNumber()
		expect(requireHookState(hookState).zoltarQuestionsFreshness).toMatchObject({ refreshing: false })

		await act(() => {
			announceNewBlock()
		})
		await waitFor(() => expect(requireHookState(hookState).zoltarUniverse?.hasForked).toBe(true))
		// The refresh keeps the loaded page on screen and does not flip the explicit loading state.
		expect(requireHookState(hookState).zoltarQuestionPage).toEqual(firstPage)
		expect(requireHookState(hookState).loadingZoltarQuestions).toBe(false)
		expect(requireHookState(hookState).zoltarQuestionsFreshness.refreshing).toBe(true)

		await act(async () => {
			refreshedPageRead.resolve(refreshedPage)
			await refreshedPageRead.promise
		})
		await waitFor(() => expect(requireHookState(hookState).zoltarQuestionPage).toEqual(refreshedPage))
		expect(requireHookState(hookState).zoltarQuestionCount).toBe(2n)
		expect(requireHookState(hookState).zoltarQuestionsFreshness.refreshing).toBe(false)
		expect(universeReads).toBe(2)
		expect(pageReads).toBe(2)
	})

	test('lets slow background universe and question reads finish across new blocks', async () => {
		const universe = { childUniverses: [], forkQuestionDetails: undefined, forkThresholdAttoRep: 100n, forkTime: 0n, forkingOutcomeIndex: 0n, hasForked: false, parentUniverseId: 0n, reputationToken: zeroAddress, totalTheoreticalSupplyAttoRep: 1000n, universeId: 1n }
		const forkedUniverse = { ...universe, forkTime: 50n, hasForked: true }
		const firstPage = { pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [createQuestion('0x01')] }
		const refreshedPage = { pageIndex: 0, pageSize: 10, questionCount: 2n, questions: [createQuestion('0x01'), createQuestion('0x02')] }
		const refreshedPageRead = createDeferred<typeof refreshedPage>()
		const staleUniverseRead = createDeferred<typeof universe>()
		let universeReads = 0
		let pageReads = 0
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: mock(async () => 1n),
			loadZoltarQuestionPage: mock(async () => {
				pageReads += 1
				if (pageReads === 1) return firstPage
				if (pageReads === 2) return await refreshedPageRead.promise
				return refreshedPage
			}),
			loadZoltarUniverseSummary: mock(async () => {
				universeReads += 1
				if (universeReads === 1) return universe
				if (universeReads === 2) return await staleUniverseRead.promise
				return forkedUniverse
			}),
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: true,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 41,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)
		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		await waitFor(() => expect(requireHookState(hookState).zoltarUniverse?.hasForked).toBe(false))
		expect(requireHookState(hookState).zoltarQuestionPage).toEqual(firstPage)
		expect(requireHookState(hookState).zoltarUniverseFreshness.updatedAt).toBeNumber()
		expect(requireHookState(hookState).zoltarQuestionsFreshness).toMatchObject({ refreshing: false })

		await act(() => {
			announceNewBlock()
		})
		await waitFor(() => expect(pageReads).toBe(2))
		await act(() => announceNewBlock())
		expect(pageReads).toBe(2)
		expect(universeReads).toBe(2)
		await act(async () => {
			refreshedPageRead.resolve(refreshedPage)
			staleUniverseRead.resolve(forkedUniverse)
			await Promise.all([refreshedPageRead.promise, staleUniverseRead.promise])
		})
		await waitFor(() => expect(requireHookState(hookState).zoltarUniverse?.hasForked).toBe(true))
		expect(requireHookState(hookState).zoltarQuestionPage).toEqual(refreshedPage)
	})

	test('a slow background read never overwrites a newer foreground page load', async () => {
		const firstPage = { pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [createQuestion('0x01')] }
		const staleBackgroundPage = { pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [createQuestion('0x0b')] }
		const foregroundPage = { pageIndex: 0, pageSize: 10, questionCount: 2n, questions: [createQuestion('0x01'), createQuestion('0x02')] }
		const backgroundRead = createDeferred<typeof firstPage>()
		let pageReads = 0
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: mock(async () => 1n),
			loadZoltarQuestionPage: mock(async () => {
				pageReads += 1
				if (pageReads === 1) return firstPage
				if (pageReads === 2) return await backgroundRead.promise
				return foregroundPage
			}),
			loadZoltarUniverseSummary: mock(async () => undefined),
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: true,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 42,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		trackCleanup(renderedComponent.cleanup)
		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		await act(() => {
			announceNewBlock()
		})
		await waitFor(() => expect(pageReads).toBe(2))
		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		expect(requireHookState(hookState).zoltarQuestionPage).toEqual(foregroundPage)
		await act(async () => {
			backgroundRead.resolve(staleBackgroundPage)
			await backgroundRead.promise
		})
		expect(requireHookState(hookState).zoltarQuestionPage).toEqual(foregroundPage)
	})

	test('loads only the created question and appends it to the loaded last page', async () => {
		const existingQuestion = createQuestion('0x01')
		const createdQuestion = createQuestion('0x02')
		const loadMarketDetails = mock(async () => createdQuestion)
		const dependencies = createZoltarUniverseDependencies({
			loadMarketDetails,
			loadZoltarQuestionCount: async () => 2n,
			loadZoltarQuestionPage: async () => ({ pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [existingQuestion] }),
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness />)
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		await act(async () => {
			await requireHookState(hookState).loadCreatedZoltarQuestion('0x2')
		})

		expect(loadMarketDetails).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).zoltarQuestions).toEqual([existingQuestion, createdQuestion])
		expect(requireHookState(hookState).zoltarQuestionCount).toBe(2n)
		expect(requireHookState(hookState).zoltarQuestionPage).toEqual({ pageIndex: 0, pageSize: 10, questionCount: 2n, questions: [existingQuestion, createdQuestion] })
		expect(requireHookState(hookState).loadingZoltarQuestions).toBe(false)
	})

	test('reports a created question that the registry does not return', async () => {
		const dependencies = createZoltarUniverseDependencies({
			loadMarketDetails: async () => ({ ...createQuestion('0x02'), exists: false }),
			loadZoltarQuestionCount: async () => 1n,
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness />)
		trackCleanup(renderedComponent.cleanup)

		let failure: unknown
		await act(async () => {
			await requireHookState(hookState)
				.loadCreatedZoltarQuestion('0x2')
				.catch((error: unknown) => {
					failure = error
				})
		})

		expect(failure).toBeInstanceOf(Error)
		expect(requireHookState(hookState).zoltarQuestions).toEqual([])
	})

	test('keeps the created question when an older page read resolves after it', async () => {
		const existingQuestion = createQuestion('0x01')
		const createdQuestion = createQuestion('0x02')
		const stalePage = createDeferred<{ pageIndex: number; pageSize: number; questionCount: bigint; questions: MarketDetails[] }>()
		let pageRequests = 0
		const dependencies = createZoltarUniverseDependencies({
			loadMarketDetails: async () => createdQuestion,
			loadZoltarQuestionCount: async () => 2n,
			loadZoltarQuestionPage: async () => {
				pageRequests += 1
				if (pageRequests === 1) return { pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [existingQuestion] }
				return await stalePage.promise
			},
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness />)
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		let stalePageRequest: Promise<void> | undefined
		await act(async () => {
			stalePageRequest = requireHookState(hookState).loadZoltarQuestionPage(0, 10)
			await Promise.resolve()
		})
		await act(async () => {
			await requireHookState(hookState).loadCreatedZoltarQuestion('0x2')
		})
		await act(async () => {
			stalePage.resolve({ pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [existingQuestion] })
			await stalePageRequest
		})

		expect(requireHookState(hookState).zoltarQuestionPage?.questions).toEqual([existingQuestion, createdQuestion])
		expect(requireHookState(hookState).zoltarQuestionCount).toBe(2n)
	})

	test('reissues a superseded read for another page after loading the created question', async () => {
		const pageZeroQuestion = createQuestion('0x01')
		const pageOneQuestion = createQuestion('0x0b')
		const createdQuestion = createQuestion('0x0c')
		const supersededPage = createDeferred<{ pageIndex: number; pageSize: number; questionCount: bigint; questions: MarketDetails[] }>()
		const pageRequests: number[] = []
		const dependencies = createZoltarUniverseDependencies({
			loadMarketDetails: async () => createdQuestion,
			loadZoltarQuestionCount: async () => 12n,
			loadZoltarQuestionPage: async (_client, pageIndex) => {
				pageRequests.push(pageIndex)
				if (pageRequests.length === 1) return { pageIndex: 0, pageSize: 10, questionCount: 11n, questions: [pageZeroQuestion] }
				if (pageRequests.length === 2) return await supersededPage.promise
				return { pageIndex: 1, pageSize: 10, questionCount: 12n, questions: [pageOneQuestion, createdQuestion] }
			},
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness />)
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		let supersededRequest: Promise<void> | undefined
		await act(async () => {
			supersededRequest = requireHookState(hookState).loadZoltarQuestionPage(1, 10)
			await Promise.resolve()
		})
		await act(async () => {
			await requireHookState(hookState).loadCreatedZoltarQuestion('0xc')
		})
		await act(async () => {
			supersededPage.resolve({ pageIndex: 1, pageSize: 10, questionCount: 11n, questions: [pageOneQuestion] })
			await supersededRequest
		})

		expect(pageRequests).toEqual([0, 1, 1])
		expect(requireHookState(hookState).zoltarQuestionPage).toEqual({ pageIndex: 1, pageSize: 10, questionCount: 12n, questions: [pageOneQuestion, createdQuestion] })
		expect(requireHookState(hookState).loadingZoltarQuestions).toBe(false)
	})

	test('reissues a superseded page read even when the created question read fails', async () => {
		const pageOneQuestion = createQuestion('0x0b')
		const supersededPage = createDeferred<{ pageIndex: number; pageSize: number; questionCount: bigint; questions: MarketDetails[] }>()
		const pageRequests: number[] = []
		const dependencies = createZoltarUniverseDependencies({
			loadMarketDetails: async () => {
				throw new Error('created question read failed')
			},
			loadZoltarQuestionCount: async () => 12n,
			loadZoltarQuestionPage: async (_client, pageIndex) => {
				pageRequests.push(pageIndex)
				if (pageRequests.length === 1) return await supersededPage.promise
				return { pageIndex: 1, pageSize: 10, questionCount: 12n, questions: [pageOneQuestion] }
			},
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: false,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness />)
		trackCleanup(renderedComponent.cleanup)

		let supersededRequest: Promise<void> | undefined
		await act(async () => {
			supersededRequest = requireHookState(hookState).loadZoltarQuestionPage(1, 10)
			await Promise.resolve()
		})
		let failure: unknown
		await act(async () => {
			await requireHookState(hookState)
				.loadCreatedZoltarQuestion('0xc')
				.catch((error: unknown) => {
					failure = error
				})
		})
		await act(async () => {
			supersededPage.resolve({ pageIndex: 1, pageSize: 10, questionCount: 11n, questions: [] })
			await supersededRequest
		})

		expect(failure).toBeInstanceOf(Error)
		expect(pageRequests).toEqual([1, 1])
		expect(requireHookState(hookState).zoltarQuestionPage).toEqual({ pageIndex: 1, pageSize: 10, questionCount: 12n, questions: [pageOneQuestion] })
		expect(requireHookState(hookState).loadingZoltarQuestions).toBe(false)
	})

	test('keeps the created question when an older block refresh of the page lands after it', async () => {
		const universe = { childUniverses: [], forkQuestionDetails: undefined, forkThresholdAttoRep: 100n, forkTime: 0n, forkingOutcomeIndex: 0n, hasForked: false, parentUniverseId: 0n, reputationToken: zeroAddress, totalTheoreticalSupplyAttoRep: 1000n, universeId: 1n }
		const existingQuestion = createQuestion('0x01')
		const createdQuestion = createQuestion('0x02')
		const firstPage = { pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [existingQuestion] }
		const staleRefresh = createDeferred<typeof firstPage>()
		let pageReads = 0
		const dependencies = createZoltarUniverseDependencies({
			loadMarketDetails: async () => createdQuestion,
			loadZoltarQuestionCount: async () => 2n,
			loadZoltarQuestionPage: async () => (++pageReads === 1 ? firstPage : await staleRefresh.promise),
			loadZoltarUniverseSummary: async () => universe,
		})
		let hookState: UseZoltarUniverseState | undefined
		function Harness() {
			hookState = useZoltarUniverse(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					autoLoadInitialData: true,
					deploymentStatuses: [createZoltarDeploymentStatus()],
					environmentRefreshKey: 43,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
				},
				dependencies,
			)
			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness />)
		trackCleanup(renderedComponent.cleanup)

		await act(async () => {
			await requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		await act(() => {
			announceNewBlock()
		})
		await waitFor(() => expect(pageReads).toBe(2))
		await act(async () => {
			await requireHookState(hookState).loadCreatedZoltarQuestion('0x2')
		})
		await act(async () => {
			staleRefresh.resolve(firstPage)
			await staleRefresh.promise
		})

		expect(requireHookState(hookState).zoltarQuestionPage).toEqual({ pageIndex: 0, pageSize: 10, questionCount: 2n, questions: [existingQuestion, createdQuestion] })
		expect(requireHookState(hookState).zoltarQuestionCount).toBe(2n)
	})
})

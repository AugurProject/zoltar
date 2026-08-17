/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { createPublicClient, getAddress, http, zeroAddress, type Hash } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { useZoltarUniverse, type UseZoltarUniverseDependencies } from '../../../features/universes/hooks/useZoltarUniverse.js'
import type { DeploymentStatus, MarketDetails } from '../../../types/contracts.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { waitFor } from '../../testUtils/queries.js'

type UseZoltarUniverseState = ReturnType<typeof useZoltarUniverse>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')
const TEST_HASH: Hash = '0x0000000000000000000000000000000000000000000000000000000000000001'

function requireHookState(state: UseZoltarUniverseState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

	return state
}

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
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
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let resetEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		resetEnvironment?.()
		resetEnvironment = undefined
		resetActiveEnvironmentForTesting()
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
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
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).createChildUniverse(0n)
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Wallet account changed. Review the action with the connected account and try again')
	})

	test('ignores stale question page results after the environment refresh key changes', async () => {
		const oldPage = createDeferred<{
			pageIndex: number
			pageSize: number
			questionCount: bigint
			questions: MarketDetails[]
		}>()
		const dependencies = createZoltarUniverseDependencies({
			loadZoltarQuestionCount: mock(async () => 1n),
			loadZoltarQuestionPage: mock(async () => await oldPage.promise),
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
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			void requireHookState(hookState).loadZoltarQuestionPage(0, 10)
		})
		await act(() => {
			render(h(Harness, { environmentRefreshKey: 1 }), renderedComponent.container)
		})
		expect(requireHookState(hookState).loadingZoltarQuestions).toBe(false)
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
		cleanupRenderedComponent = renderedComponent.cleanup

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
		expect(requireHookState(hookState).zoltarQuestionLookupError).toBe('Enter a valid hexadecimal question ID')
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
		cleanupRenderedComponent = renderedComponent.cleanup

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
		cleanupRenderedComponent = renderedComponent.cleanup

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
		cleanupRenderedComponent = renderedComponent.cleanup

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
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => undefined)
		expect(loadZoltarQuestionCount).not.toHaveBeenCalled()
		expect(requireHookState(hookState).zoltarQuestionsError).toBeUndefined()
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
		cleanupRenderedComponent = renderedComponent.cleanup

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
		cleanupRenderedComponent = renderedComponent.cleanup

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
})

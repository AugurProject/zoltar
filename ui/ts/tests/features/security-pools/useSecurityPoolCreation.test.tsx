/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { waitFor } from '../../testUtils/queries'
import { zeroAddress, type Address, type Hash } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import type { DeploymentStatus, MarketDetails, SecurityPoolCreationResult } from '../../../types/contracts.js'

type UseSecurityPoolCreation = typeof import('../../../features/security-pools/hooks/useSecurityPoolCreation.js')['useSecurityPoolCreation']
type UseSecurityPoolCreationState = ReturnType<UseSecurityPoolCreation>

type MarketIdLoadResult = MarketDetails

type MockContractDeps = {
	loadMarketDetails: ReturnType<typeof mock>
	originSecurityPoolExists: ReturnType<typeof mock>
	createSecurityPool: ReturnType<typeof mock>
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

function createMarketDetails(overrides: Partial<MarketDetails> = {}): MarketIdLoadResult {
	return {
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
		questionId: '0x0b',
		startTime: 1n,
		title: 'Will this resolve?',
		...overrides,
	}
}

function createStatus(id: DeploymentStatus['id'], deployed: boolean, dependencies: DeploymentStatus['id'][] = []): DeploymentStatus {
	return {
		address: zeroAddress,
		dependencies,
		deployed,
		deploy: async () => '0x0',
		id,
		label: id,
	}
}

function setupContractMocks({ loadMarketDetails, createSecurityPool, originSecurityPoolExists }: Partial<MockContractDeps>) {
	mock.module('../../../protocol/index.js', () => ({
		loadMarketDetails: loadMarketDetails ?? mock(async () => createMarketDetails()),
		createSecurityPool:
			createSecurityPool ??
			mock(
				async () =>
					({
						deployPoolHash: '0x0' as Hash,
						initialReportPriorityFeeWeiPerGas: 10_000_000_000n,
						questionId: '0x0b',
						securityPoolAddress: zeroAddress,
						securityMultiplier: 2n,
						universeId: 0n,
					}) as SecurityPoolCreationResult,
			),
		originSecurityPoolExists: originSecurityPoolExists ?? mock(async () => false),
	}))

	mock.module('../../../lib/clients.js', () => ({
		createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
		createWalletWriteClient: mock((walletAddress: Address, options: { onTransactionSubmitted: (hash: Hash) => void }) => ({
			walletAddress,
			onTransactionSubmitted: options.onTransactionSubmitted,
		})),
	}))
}

function requireState(state: UseSecurityPoolCreationState | undefined): UseSecurityPoolCreationState {
	if (state === undefined) {
		throw new Error('Security pool creation hook state is unavailable')
	}
	return state
}

function createHarness(useSecurityPoolCreation: UseSecurityPoolCreation, props: Parameters<UseSecurityPoolCreation>[0], onRender: (state: UseSecurityPoolCreationState) => void) {
	return function SecurityPoolCreationHarness() {
		const state = useSecurityPoolCreation(props)
		onRender(state)
		return <div />
	}
}

describe('useSecurityPoolCreation', () => {
	let cleanupDom: (() => void) | undefined
	let restoreActiveEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: zeroAddress }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = undefined
		cleanupDom?.()
		cleanupDom = undefined
		mock.restore()
	})

	test('loadMarketById blocks before ZoltarQuestionData is deployed', async () => {
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails()),
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('proxyDeployer', true), createStatus('zoltarQuestionData', false)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireState(state).loadMarketById('11')
		})
		expect(requireState(state).securityPoolError).toBe('Deploy ZoltarQuestionData before selecting a question')
		expect(requireState(state).marketDetails).toBeUndefined()
	})

	test('loadMarketById maps successful and failed market lookups', async () => {
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails({ exists: false, questionId: '0x00' })),
		})
		let state: UseSecurityPoolCreationState | undefined
		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		const HarnessNotFound = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('proxyDeployer', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedNotFound = await renderIntoDocument(<HarnessNotFound />)
		cleanupRenderedComponent = renderedNotFound.cleanup
		await act(async () => {
			await requireState(state).loadMarketById('11')
		})
		expect(requireState(state).securityPoolError).toBe('No market found for that ID')
		renderedNotFound.cleanup()
		cleanupRenderedComponent = undefined

		setupContractMocks({
			loadMarketDetails: mock(async () => {
				throw new Error('backend offline')
			}),
		})

		const HarnessError = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('proxyDeployer', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)
		const renderedError = await renderIntoDocument(<HarnessError />)
		cleanupRenderedComponent = renderedError.cleanup
		await act(async () => {
			await requireState(state).loadMarketById('11')
		})
		expect(requireState(state).securityPoolError).toBe('Failed to load market. Reason: backend offline')
	})

	test('loadMarketById ignores stale results when market lookups resolve out of order', async () => {
		const firstLookup = createDeferred<MarketIdLoadResult>()
		const secondLookup = createDeferred<MarketIdLoadResult>()
		const loadMarketDetails = mock(async (_client: unknown, questionId: bigint) => {
			if (questionId === 11n) return await firstLookup.promise
			if (questionId === 12n) return await secondLookup.promise
			throw new Error(`Unexpected question ID: ${questionId.toString()}`)
		})
		setupContractMocks({
			loadMarketDetails,
			originSecurityPoolExists: mock(async () => false),
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('proxyDeployer', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		let firstLoadPromise = Promise.resolve()
		await act(() => {
			firstLoadPromise = requireState(state).loadMarketById('11')
		})

		let secondLoadPromise = Promise.resolve()
		await act(() => {
			secondLoadPromise = requireState(state).loadMarketById('12')
		})

		secondLookup.resolve(createMarketDetails({ questionId: '0x0c', title: 'Question B' }))
		await secondLoadPromise
		expect(requireState(state).marketDetails?.questionId).toBe('0x0c')

		firstLookup.resolve(createMarketDetails({ questionId: '0x0b', title: 'Question A' }))
		await firstLoadPromise
		expect(requireState(state).marketDetails?.questionId).toBe('0x0c')
		expect(requireState(state).marketDetails?.title).toBe('Question B')
		expect(loadMarketDetails).toHaveBeenCalledTimes(2)
	})

	test('loads duplicate checks for valid input and skips malformed question IDs', async () => {
		const originSecurityPoolExists = mock(async () => true)
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails()),
			originSecurityPoolExists,
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('proxyDeployer', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)
		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: 'abc', securityMultiplier: 'bad' }))
		})
		expect(originSecurityPoolExists).toHaveBeenCalledTimes(0)

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
		})
		await waitFor(() => {
			expect(originSecurityPoolExists).toHaveBeenCalledTimes(1)
		})
		expect(requireState(state).duplicateOriginPoolExists).toBe(true)
	})

	test('ignores stale duplicate-origin responses when market inputs change out of order', async () => {
		const firstDuplicateCheck = createDeferred<boolean>()
		const secondDuplicateCheck = createDeferred<boolean>()
		const originSecurityPoolExists = mock(async (_client: unknown, questionId: bigint) => {
			if (questionId === 11n) return await firstDuplicateCheck.promise
			if (questionId === 12n) return await secondDuplicateCheck.promise
			throw new Error(`Unexpected question ID: ${questionId.toString()}`)
		})
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails()),
			originSecurityPoolExists,
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('proxyDeployer', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)
		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
		})
		await waitFor(() => {
			expect(originSecurityPoolExists).toHaveBeenCalledTimes(1)
		})

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '12', securityMultiplier: '2' }))
		})
		await waitFor(() => {
			expect(originSecurityPoolExists).toHaveBeenCalledTimes(2)
		})

		secondDuplicateCheck.resolve(true)
		await waitFor(() => {
			expect(requireState(state).duplicateOriginPoolExists).toBe(true)
		})

		firstDuplicateCheck.resolve(false)
		await waitFor(() => {
			expect(requireState(state).duplicateOriginPoolExists).toBe(true)
		})
	})

	test('auto-loads market details when a valid question ID is entered', async () => {
		const loadedDetails = createMarketDetails({ questionId: '0x0b', title: 'Auto loaded question' })
		const loadedQuestionIds: bigint[] = []
		const loadMarketDetails = mock(async (_client: unknown, questionId: bigint) => {
			loadedQuestionIds.push(questionId)
			return loadedDetails
		})
		setupContractMocks({
			loadMarketDetails,
			originSecurityPoolExists: mock(async () => false),
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('proxyDeployer', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)
		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '0x0b' }))
		})

		await waitFor(() => {
			expect(loadMarketDetails).toHaveBeenCalledTimes(1)
			expect(loadedQuestionIds).toEqual([11n])
			expect(requireState(state).marketDetails?.title).toBe('Auto loaded question')
		})
	})

	test('createPool blocks when required deployment step is missing', async () => {
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails()),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool: mock(async () => {
				throw new Error('createSecurityPool should not run')
			}),
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', false), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
		})
		await act(() => {
			requireState(state).loadMarketById('11')
		})
		await waitFor(() => {
			expect(requireState(state).marketDetails?.questionId).toBe('0x0b')
		})

		await act(async () => {
			await requireState(state).createPool()
		})

		expect(requireState(state).securityPoolCreationFeedback?.status.tone).toBe('error')
		expect(requireState(state).securityPoolCreationFeedback?.status.detail).toContain('Deploy SecurityPoolFactory before creating a security pool')
	})

	test('createPool succeeds and refreshes state when all preconditions pass', async () => {
		const createSecurityPool = mock(async (client: { onTransactionSubmitted?: (hash: Hash) => void }) => {
			client.onTransactionSubmitted?.('0xabc')
			return {
				deployPoolHash: '0xabc' as Hash,
				initialReportPriorityFeeWeiPerGas: 10_000_000_000n,
				questionId: '0x0b',
				securityPoolAddress: '0x1111111111111111111111111111111111111111',
				securityMultiplier: 2n,
				universeId: 0n,
			} as SecurityPoolCreationResult
		})
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails({ questionId: '0x0b' })),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool,
		})

		const onTransactionHashes: Hash[] = []
		const onTransactionPresented = (presentation: { hash?: Hash }) => {
			if (presentation.hash !== undefined) onTransactionHashes.push(presentation.hash)
		}
		let refreshCalls = 0
		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => {
					refreshCalls += 1
				},
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
			requireState(state).loadMarketById('11')
		})
		await waitFor(() => {
			expect(requireState(state).marketDetails?.questionId).toBe('0x0b')
		})

		await act(async () => {
			await requireState(state).createPool()
		})

		expect(requireState(state).securityPoolResult?.questionId).toBe('0x0b')
		expect(requireState(state).securityPoolResult?.deployPoolHash).toBe('0xabc')
		expect(requireState(state).securityPoolCreationFeedback?.status.tone).toBe('success')
		expect(requireState(state).securityPoolCreationFeedback?.status.hash).toBe('0xabc')
		expect(onTransactionHashes).toContain('0xabc')
		expect(refreshCalls).toBe(1)
	})

	test('createPool preserves the current market details when a stale duplicate-pool error resolves for an older market', async () => {
		const staleDuplicateCheck = createDeferred<boolean>()
		setupContractMocks({
			loadMarketDetails: mock(async (_client: unknown, questionId: bigint) => {
				if (questionId === 11n) return createMarketDetails({ questionId: '0x0b', title: 'Question A' })
				if (questionId === 12n) return createMarketDetails({ questionId: '0x0c', title: 'Question B' })
				throw new Error(`Unexpected question ID: ${questionId.toString()}`)
			}),
			originSecurityPoolExists: mock(async (_client: unknown, questionId: bigint) => {
				if (questionId === 11n) return await staleDuplicateCheck.promise
				return false
			}),
			createSecurityPool: mock(async () => {
				throw new Error('createSecurityPool should not run when duplicate preflight fails')
			}),
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', true), createStatus('zoltarQuestionData', true)],
				enabled: false,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
			await requireState(state).loadMarketById('11')
		})
		expect(requireState(state).marketDetails?.questionId).toBe('0x0b')

		let createPromise = Promise.resolve()
		await act(() => {
			createPromise = requireState(state).createPool()
		})

		await act(async () => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '12' }))
			await requireState(state).loadMarketById('12')
		})
		expect(requireState(state).marketDetails?.questionId).toBe('0x0c')

		await act(async () => {
			staleDuplicateCheck.resolve(true)
			await createPromise
		})

		expect(requireState(state).securityPoolCreationFeedback?.status.tone).toBe('error')
		expect(requireState(state).securityPoolCreationFeedback?.status.detail).toContain('already exists')
		expect(requireState(state).marketDetails?.questionId).toBe('0x0c')
		expect(requireState(state).marketDetails?.title).toBe('Question B')
	})

	test('createPool preserves the current market details when a stale non-binary error resolves for an older market', async () => {
		const staleSubmittedMarket = createDeferred<MarketIdLoadResult>()
		setupContractMocks({
			loadMarketDetails: mock(async (_client: unknown, questionId: bigint) => {
				if (questionId === 11n) return await staleSubmittedMarket.promise
				if (questionId === 12n) return createMarketDetails({ questionId: '0x0c', title: 'Question B' })
				throw new Error(`Unexpected question ID: ${questionId.toString()}`)
			}),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool: mock(async () => {
				throw new Error('createSecurityPool should not run when the market is not binary')
			}),
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', true), createStatus('zoltarQuestionData', true)],
				enabled: false,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
		})

		let createPromise = Promise.resolve()
		await act(() => {
			createPromise = requireState(state).createPool()
		})

		await act(async () => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '12' }))
			await requireState(state).loadMarketById('12')
		})
		expect(requireState(state).marketDetails?.questionId).toBe('0x0c')

		await act(async () => {
			staleSubmittedMarket.resolve(createMarketDetails({ marketType: 'scalar', questionId: '0x0b', title: 'Question A' }))
			await createPromise
		})

		expect(requireState(state).securityPoolCreationFeedback?.status.tone).toBe('error')
		expect(requireState(state).securityPoolCreationFeedback?.status.detail).toContain('only be deployed for binary markets')
		expect(requireState(state).marketDetails?.questionId).toBe('0x0c')
		expect(requireState(state).marketDetails?.title).toBe('Question B')
	})

	test('createPool blocks repeated calls while still in progress', async () => {
		let pendingCreate: ReturnType<typeof createDeferred<SecurityPoolCreationResult>> | undefined
		const createSecurityPool = mock(async (client: { onTransactionSubmitted?: (hash: Hash) => void }) => {
			client.onTransactionSubmitted?.('0xabc')
			const deferred = createDeferred<SecurityPoolCreationResult>()
			pendingCreate = deferred
			return deferred.promise
		})
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails({ questionId: '0x0b' })),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool,
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		let createdCount = 0
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionPresented: () => {
					createdCount += 1
				},
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
			requireState(state).loadMarketById('11')
		})
		await waitFor(() => {
			expect(requireState(state).marketDetails?.questionId).toBe('0x0b')
		})

		let firstCreate: Promise<void> | undefined
		await act(() => {
			firstCreate = requireState(state).createPool()
		})
		if (firstCreate === undefined) {
			throw new Error('Expected createPool promise')
		}
		await waitFor(() => {
			expect(requireState(state).securityPoolCreating).toBe(true)
		})

		await act(async () => {
			await requireState(state).createPool()
		})
		expect(requireState(state).securityPoolError).toBe('Security pool creation already in progress')

		if (pendingCreate === undefined) {
			throw new Error('Expected deferred createSecurityPool promise')
		}
		pendingCreate.resolve({
			deployPoolHash: '0xabc',
			initialReportPriorityFeeWeiPerGas: 10_000_000_000n,
			questionId: '0x0b',
			securityPoolAddress: '0x1111111111111111111111111111111111111111',
			securityMultiplier: 2n,
			universeId: 0n,
		})
		await firstCreate
		expect(createdCount).toBe(1)
	})

	test('createPool blocks repeated submissions before wallet preflight finishes', async () => {
		const pendingCreate = createDeferred<SecurityPoolCreationResult>()
		const createSecurityPool = mock(async (client: { onTransactionSubmitted?: (hash: Hash) => void }) => {
			client.onTransactionSubmitted?.('0xabc')
			return await pendingCreate.promise
		})
		const onTransactionRequested = mock(() => undefined)
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails({ questionId: '0x0b' })),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool,
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
			requireState(state).loadMarketById('11')
		})
		await waitFor(() => {
			expect(requireState(state).marketDetails?.questionId).toBe('0x0b')
		})

		let firstCreate: Promise<void> | undefined
		let secondCreate: Promise<void> | undefined
		await act(() => {
			firstCreate = requireState(state).createPool()
			secondCreate = requireState(state).createPool()
		})
		if (firstCreate === undefined || secondCreate === undefined) {
			throw new Error('Expected both createPool promises')
		}

		await waitFor(() => {
			expect(onTransactionRequested).toHaveBeenCalledTimes(1)
		})
		expect(createSecurityPool).toHaveBeenCalledTimes(1)
		expect(requireState(state).securityPoolCreationFeedback?.status.tone).toBe('pending')

		pendingCreate.resolve({
			deployPoolHash: '0xabc' as Hash,
			initialReportPriorityFeeWeiPerGas: 10_000_000_000n,
			questionId: '0x0b',
			securityPoolAddress: '0x1111111111111111111111111111111111111111',
			securityMultiplier: 2n,
			universeId: 0n,
		})

		await firstCreate
		await secondCreate

		expect(createSecurityPool).toHaveBeenCalledTimes(1)
		expect(requireState(state).securityPoolCreationFeedback?.status.tone).toBe('success')
	})

	test('createPool keeps the current loaded market when the selected market changes before success', async () => {
		const createPoolDeferred = createDeferred<SecurityPoolCreationResult>()
		const createSecurityPool = mock(async (client: { onTransactionSubmitted?: (hash: Hash) => void }) => {
			client.onTransactionSubmitted?.('0xabc')
			return await createPoolDeferred.promise
		})
		setupContractMocks({
			loadMarketDetails: mock(async (_client: unknown, questionId: bigint) => {
				if (questionId === 11n) return createMarketDetails({ questionId: '0x0b', title: 'Question A' })
				if (questionId === 12n) return createMarketDetails({ questionId: '0x0c', title: 'Question B' })
				throw new Error(`Unexpected question ID: ${questionId.toString()}`)
			}),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool,
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionPresented: () => undefined,
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
			requireState(state).loadMarketById('11')
		})
		await waitFor(() => {
			expect(requireState(state).marketDetails?.questionId).toBe('0x0b')
		})

		let firstCreate: Promise<void> | undefined
		await act(() => {
			firstCreate = requireState(state).createPool()
		})
		if (firstCreate === undefined) {
			throw new Error('Expected createPool promise')
		}
		await waitFor(() => {
			expect(requireState(state).securityPoolCreating).toBe(true)
		})

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '12' }))
		})
		await waitFor(() => {
			expect(requireState(state).marketDetails?.questionId).toBe('0x0c')
		})

		createPoolDeferred.resolve({
			deployPoolHash: '0xabc',
			initialReportPriorityFeeWeiPerGas: 10_000_000_000n,
			questionId: '0x0b',
			securityPoolAddress: '0x1111111111111111111111111111111111111111',
			securityMultiplier: 2n,
			universeId: 0n,
		})
		await firstCreate

		expect(requireState(state).securityPoolResult?.questionId).toBe('0x0b')
		expect(requireState(state).poolCreationMarketDetails?.questionId).toBe('0x0b')
		expect(requireState(state).marketDetails?.questionId).toBe('0x0c')
		expect(requireState(state).marketDetails?.title).toBe('Question B')
	})

	test('createPool does not get stuck after a pre-request wallet disconnect', async () => {
		const createSecurityPool = mock(async () => {
			throw new Error('createSecurityPool should not run before the wallet preflight passes')
		})
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails({ questionId: '0x0b' })),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool,
		})

		const onTransactionRequested = mock(() => undefined)
		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionPresented: () => undefined,
				onTransactionFinished: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
			requireState(state).loadMarketById('11')
		})
		await waitFor(() => {
			expect(requireState(state).marketDetails?.questionId).toBe('0x0b')
		})

		restoreActiveEnvironment?.()
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend())

		await act(async () => {
			await requireState(state).createPool()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(createSecurityPool).not.toHaveBeenCalled()
		expect(requireState(state).securityPoolCreating).toBe(false)
		expect(requireState(state).securityPoolCreationFeedback?.status.tone).toBe('error')
		expect(requireState(state).securityPoolCreationFeedback?.status.detail).toContain('Wallet account is no longer connected')

		restoreActiveEnvironment?.()
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: zeroAddress }))

		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails({ questionId: '0x0b' })),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool: mock(async () => ({
				deployPoolHash: '0xabc' as Hash,
				initialReportPriorityFeeWeiPerGas: 10_000_000_000n,
				questionId: '0x0b',
				securityPoolAddress: '0x1111111111111111111111111111111111111111',
				securityMultiplier: 2n,
				universeId: 0n,
			})),
		})

		await act(async () => {
			await requireState(state).createPool()
		})

		expect(onTransactionRequested).toHaveBeenCalledTimes(1)
		expect(requireState(state).securityPoolCreating).toBe(false)
		expect(requireState(state).securityPoolCreationFeedback?.status.tone).toBe('success')
	})

	test('createPool snapshots the submitted form before wallet preflight resolves', async () => {
		const activeAccounts = createDeferred<readonly Address[]>()
		const createSecurityPool = mock(async (_client: unknown, parameters: { questionId: bigint; securityMultiplier: bigint }) => ({
			deployPoolHash: '0xabc' as Hash,
			initialReportPriorityFeeWeiPerGas: 10_000_000_000n,
			questionId: `0x${parameters.questionId.toString(16)}`,
			securityPoolAddress: '0x1111111111111111111111111111111111111111',
			securityMultiplier: parameters.securityMultiplier,
			universeId: 0n,
		}))
		setupContractMocks({
			loadMarketDetails: mock(async (_client: unknown, questionId: bigint) => createMarketDetails({ questionId: `0x${questionId.toString(16)}` })),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool,
		})

		restoreActiveEnvironment?.()
		restoreActiveEnvironment = installActiveEnvironmentForTesting({
			...createFakeBackend({ accountAddress: zeroAddress }),
			getAccounts: async () => await activeAccounts.promise,
		})

		const { useSecurityPoolCreation } = await import(`../../../features/security-pools/hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				zoltarUniverseHasForked: false,
			},
			newState => {
				state = newState
			},
		)

		const renderedComponent = await renderIntoDocument(<Harness />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '11', securityMultiplier: '2' }))
		})

		let createPromise = Promise.resolve()
		await act(() => {
			createPromise = requireState(state).createPool()
		})

		await act(async () => {
			requireState(state).setSecurityPoolForm(current => ({ ...current, marketId: '12', securityMultiplier: '3' }))
		})

		await act(async () => {
			activeAccounts.resolve([zeroAddress])
			await createPromise
		})

		expect(createSecurityPool).toHaveBeenCalledTimes(1)
		expect(createSecurityPool.mock.calls[0]?.[1]).toMatchObject({
			questionId: 11n,
			securityMultiplier: 2n,
		})
		expect(requireState(state).securityPoolResult?.questionId).toBe('0xb')
	})
})

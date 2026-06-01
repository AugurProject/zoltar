/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { waitFor } from '@testing-library/dom'
import { zeroAddress, type Address, type Hash } from 'viem'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import type { DeploymentStatus, MarketDetails, SecurityPoolCreationResult } from '../types/contracts.js'

type UseSecurityPoolCreation = typeof import('../hooks/useSecurityPoolCreation.js')['useSecurityPoolCreation']
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
	mock.module('../contracts.js', () => ({
		loadMarketDetails: loadMarketDetails ?? mock(async () => createMarketDetails()),
		createSecurityPool: createSecurityPool ?? mock(async () => ({
			deployPoolHash: '0x0' as Hash,
			questionId: '0x0b',
			securityPoolAddress: zeroAddress,
		} as SecurityPoolCreationResult)),
		originSecurityPoolExists: originSecurityPoolExists ?? mock(async () => false),
	}))

	mock.module('../lib/clients.js', () => ({
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

function createHarness(
	useSecurityPoolCreation: UseSecurityPoolCreation,
	props: Parameters<UseSecurityPoolCreation>[0],
	onRender: (state: UseSecurityPoolCreationState) => void,
) {
	return function SecurityPoolCreationHarness() {
		const state = useSecurityPoolCreation(props)
		onRender(state)
		return <div />
	}
}

describe('useSecurityPoolCreation', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
		mock.restore()
	})

	test('loadMarketById blocks before ZoltarQuestionData is deployed', async () => {
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails()),
		})

		const { useSecurityPoolCreation } = await import(`../hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('proxyDeployer', true), createStatus('zoltarQuestionData', false)],
				enabled: true,
				onTransaction: () => undefined,
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

		await act(async () => {
			await requireState(state).loadMarketById('11')
		})
		expect(requireState(state).securityPoolError).toBe('Deploy ZoltarQuestionData before loading a market')
		expect(requireState(state).marketDetails).toBeUndefined()
	})

	test('loadMarketById maps successful and failed market lookups', async () => {
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails({ exists: false, questionId: '0x00' })),
		})
		let state: UseSecurityPoolCreationState | undefined
		const { useSecurityPoolCreation } = await import(`../hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		const HarnessNotFound = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('proxyDeployer', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransaction: () => undefined,
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
				onTransaction: () => undefined,
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
		const renderedError = await renderIntoDocument(<HarnessError />)
		cleanupRenderedComponent = renderedError.cleanup
		await act(async () => {
			await requireState(state).loadMarketById('11')
		})
		expect(requireState(state).securityPoolError).toBe('Failed to load market. Reason: backend offline')
	})

	test('loads duplicate checks for valid input and skips malformed question IDs', async () => {
		const originSecurityPoolExists = mock(async () => true)
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails()),
			originSecurityPoolExists,
		})

		const { useSecurityPoolCreation } = await import(`../hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('proxyDeployer', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransaction: () => undefined,
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

	test('createPool blocks when required deployment step is missing', async () => {
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails()),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool: mock(async () => {
				throw new Error('createSecurityPool should not run')
			}),
		})

		const { useSecurityPoolCreation } = await import(`../hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', false), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransaction: () => undefined,
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
				questionId: '0x0b',
				securityPoolAddress: '0x1111111111111111111111111111111111111111',
			} as SecurityPoolCreationResult
		})
		setupContractMocks({
			loadMarketDetails: mock(async () => createMarketDetails({ questionId: '0x0b' })),
			originSecurityPoolExists: mock(async () => false),
			createSecurityPool,
		})

		const onTransactionHashes: Hash[] = []
		const onTransaction = (hash: Hash) => onTransactionHashes.push(hash)
		let refreshCalls = 0
		const { useSecurityPoolCreation } = await import(`../hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransaction,
				onTransactionFinished: () => undefined,
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

		const { useSecurityPoolCreation } = await import(`../hooks/useSecurityPoolCreation.js?case=${crypto.randomUUID()}`)
		let state: UseSecurityPoolCreationState | undefined
		let createdCount = 0
		const Harness = createHarness(
			useSecurityPoolCreation,
			{
				accountAddress: zeroAddress,
				deploymentStatuses: [createStatus('securityPoolFactory', true), createStatus('zoltarQuestionData', true)],
				enabled: true,
				onTransaction: () => {
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

		let firstCreate: Promise<void>
		await act(() => {
			firstCreate = requireState(state).createPool()
		})
		expect(requireState(state).securityPoolCreating).toBe(true)

		await act(async () => {
			await requireState(state).createPool()
		})
		expect(requireState(state).securityPoolError).toBe('Security pool creation already in progress')

		if (pendingCreate === undefined) {
			throw new Error('Expected deferred createSecurityPool promise')
		}
		pendingCreate.resolve({
			deployPoolHash: '0xabc',
			questionId: '0x0b',
			securityPoolAddress: '0x1111111111111111111111111111111111111111',
		})
		await firstCreate
		expect(createdCount).toBe(1)
	})
})

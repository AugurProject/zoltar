/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, type Address, type Hash } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { waitFor } from './testUtils/queries'
import type { DeploymentStatus, MarketCreationResult } from '../types/contracts.js'

type UseMarketCreation = typeof import('../hooks/useMarketCreation.js')['useMarketCreation']
type UseMarketCreationState = ReturnType<UseMarketCreation>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createStatus(id: DeploymentStatus['id'], deployed: boolean, dependencies: DeploymentStatus['id'][] = []): DeploymentStatus {
	return {
		address: getAddress('0x00000000000000000000000000000000000000d1'),
		dependencies,
		deploy: async () => '0x0',
		deployed,
		id,
		label: id,
	}
}

function requireHookState(state: UseMarketCreationState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

	return state
}

describe('useMarketCreation', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let resetEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
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

	test('blocks repeated market creation submissions while the first request is still preparing', async () => {
		const pendingCreate = createDeferred<MarketCreationResult>()
		const createMarketTransaction = mock(async (client: { onTransactionSubmitted?: (hash: Hash) => void }) => {
			client.onTransactionSubmitted?.('0xabc')
			return await pendingCreate.promise
		})
		const loadZoltarQuestions = mock(async () => undefined)
		const setZoltarForkQuestionId = mock(() => undefined)

		mock.module('../contracts.js', () => ({
			createMarket: createMarketTransaction,
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock((walletAddress: Address, options: { onTransactionSubmitted?: (hash: Hash) => void }) => ({
				onTransactionSubmitted: options.onTransactionSubmitted,
				walletAddress,
			})),
		}))
		mock.module('../hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: mock(() => ({
				loadZoltarQuestions,
				setZoltarForkQuestionId,
			})),
		}))

		const { useMarketCreation } = await import(`../hooks/useMarketCreation.js?case=${crypto.randomUUID()}`)
		let hookState: UseMarketCreationState | undefined
		const Harness = function MarketCreationHarness() {
			hookState = useMarketCreation({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 0n,
				activeZoltarView: 'create',
				autoLoadInitialData: false,
				deploymentStatuses: [createStatus('zoltarQuestionData', true)],
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setMarketForm(current => ({
				...current,
				endTime: '2026-07-02T00:00:00.000Z',
				title: 'Will this resolve?',
			}))
		})

		let firstCreate: Promise<void> | undefined
		let secondCreate: Promise<void> | undefined
		await act(() => {
			firstCreate = requireHookState(hookState).createMarket()
			secondCreate = requireHookState(hookState).createMarket()
		})
		if (firstCreate === undefined || secondCreate === undefined) {
			throw new Error('Expected both createMarket promises')
		}

		await waitFor(() => {
			expect(createMarketTransaction).toHaveBeenCalledTimes(1)
		})
		expect(requireHookState(hookState).marketFeedback?.status.tone).toBe('pending')

		pendingCreate.resolve({
			createQuestionHash: '0xabc',
			marketType: 'binary',
			questionId: '0x0b',
		})

		await firstCreate
		await secondCreate

		expect(loadZoltarQuestions).toHaveBeenCalledTimes(1)
		expect(setZoltarForkQuestionId).toHaveBeenCalledWith('0x0b')
	})

	test('clears the submission-in-progress latch after a pre-request wallet disconnect', async () => {
		const createMarketTransaction = mock(async () => ({
			createQuestionHash: '0xabc' as Hash,
			marketType: 'binary' as const,
			questionId: '0x0b',
		}))
		const loadZoltarQuestions = mock(async () => undefined)
		const setZoltarForkQuestionId = mock(() => undefined)
		const onTransactionRequested = mock(() => undefined)

		mock.module('../contracts.js', () => ({
			createMarket: createMarketTransaction,
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock((walletAddress: Address, options: { onTransactionSubmitted?: (hash: Hash) => void }) => ({
				onTransactionSubmitted: options.onTransactionSubmitted,
				walletAddress,
			})),
		}))
		mock.module('../hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: mock(() => ({
				loadZoltarQuestions,
				setZoltarForkQuestionId,
			})),
		}))

		const { useMarketCreation } = await import(`../hooks/useMarketCreation.js?case=${crypto.randomUUID()}`)
		let hookState: UseMarketCreationState | undefined
		const Harness = function MarketCreationHarness() {
			hookState = useMarketCreation({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 0n,
				activeZoltarView: 'create',
				autoLoadInitialData: false,
				deploymentStatuses: [createStatus('zoltarQuestionData', true)],
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setMarketForm(current => ({
				...current,
				endTime: '2026-07-02T00:00:00.000Z',
				title: 'Will this resolve?',
			}))
		})

		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend())

		await act(async () => {
			await requireHookState(hookState).createMarket()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(createMarketTransaction).not.toHaveBeenCalled()
		expect(requireHookState(hookState).marketFeedback?.status.tone).toBe('error')
		expect(requireHookState(hookState).marketFeedback?.status.detail).toContain('Wallet account is no longer connected')

		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))

		await act(async () => {
			await requireHookState(hookState).createMarket()
		})

		expect(onTransactionRequested).toHaveBeenCalledTimes(1)
		expect(createMarketTransaction).toHaveBeenCalledTimes(1)
		expect(loadZoltarQuestions).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).marketFeedback?.status.tone).toBe('success')
	})

	test('createMarket snapshots the submitted form before wallet preflight resolves', async () => {
		const activeAccounts = createDeferred<readonly Address[]>()
		const createMarketTransaction = mock(async (_client: unknown, parameters: { questionData: { title: string } }) => {
			return {
				createQuestionHash: '0xabc' as Hash,
				marketType: 'binary' as const,
				questionId: parameters.questionData.title === 'Question A' ? '0x0b' : '0x0c',
			}
		})
		const loadZoltarQuestions = mock(async () => undefined)
		const setZoltarForkQuestionId = mock(() => undefined)

		mock.module('../contracts.js', () => ({
			createMarket: createMarketTransaction,
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock((walletAddress: Address, options: { onTransactionSubmitted?: (hash: Hash) => void }) => ({
				onTransactionSubmitted: options.onTransactionSubmitted,
				walletAddress,
			})),
		}))
		mock.module('../hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: mock(() => ({
				loadZoltarQuestions,
				setZoltarForkQuestionId,
			})),
		}))

		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting({
			...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
			getAccounts: async () => await activeAccounts.promise,
		})

		const { useMarketCreation } = await import(`../hooks/useMarketCreation.js?case=${crypto.randomUUID()}`)
		let hookState: UseMarketCreationState | undefined
		const Harness = function MarketCreationHarness() {
			hookState = useMarketCreation({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 0n,
				activeZoltarView: 'create',
				autoLoadInitialData: false,
				deploymentStatuses: [createStatus('zoltarQuestionData', true)],
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setMarketForm(current => ({
				...current,
				endTime: '2026-07-02T00:00:00.000Z',
				title: 'Question A',
			}))
		})

		let createPromise = Promise.resolve()
		await act(() => {
			createPromise = requireHookState(hookState).createMarket()
		})

		await act(async () => {
			requireHookState(hookState).setMarketForm(current => ({
				...current,
				title: 'Question B',
			}))
		})

		await act(async () => {
			activeAccounts.resolve([WALLET_ADDRESS])
			await createPromise
		})

		expect(createMarketTransaction).toHaveBeenCalledTimes(1)
		expect(createMarketTransaction.mock.calls[0]?.[1].questionData.title).toBe('Question A')
		expect(loadZoltarQuestions).toHaveBeenCalledTimes(1)
		expect(setZoltarForkQuestionId).toHaveBeenCalledWith('0x0b')
	})
})

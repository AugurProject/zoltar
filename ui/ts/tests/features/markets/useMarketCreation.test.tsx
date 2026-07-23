/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, type Address, type Hash } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../../../lib/activeEnvironment.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import { waitFor } from '../../testUtils/queries'
import type { DeploymentStatus, MarketCreationResult } from '../../../types/contracts.js'
import type { MarketFormState } from '../../../types/app.js'
import type { UseMarketCreationDependencies } from '../../../features/markets/hooks/useMarketCreation.js'

type UseMarketCreation = typeof import('../../../features/markets/hooks/useMarketCreation.js')['useMarketCreation']
type UseMarketCreationState = ReturnType<UseMarketCreation>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const SECOND_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a2')

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
		const pendingCreate = createDeferred<MarketCreationResult & { hash: Hash }>()
		const createMarketTransaction = mock(async (_accountAddress: Address, callbacks: { onTransactionSubmitted: (hash: Hash) => void }) => {
			callbacks.onTransactionSubmitted('0xabc')
			return await pendingCreate.promise
		})
		const loadZoltarQuestions = mock(async () => undefined)
		const setZoltarForkQuestionId = mock(() => undefined)
		const dependencies: UseMarketCreationDependencies = {
			createMarket: createMarketTransaction,
		}
		mock.module('../../../features/universes/hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: mock(() => ({
				loadZoltarQuestions,
				setZoltarForkQuestionId,
			})),
		}))

		const { useMarketCreation } = await import(`../../../features/markets/hooks/useMarketCreation.js?case=${crypto.randomUUID()}`)
		let hookState: UseMarketCreationState | undefined
		const Harness = function MarketCreationHarness() {
			hookState = useMarketCreation(
				{
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
				},
				dependencies,
			)

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
			hash: '0xabc',
			marketType: 'binary',
			questionId: '0x0b',
		})

		await firstCreate
		await secondCreate

		expect(loadZoltarQuestions).toHaveBeenCalledTimes(1)
		expect(setZoltarForkQuestionId).toHaveBeenCalledWith('0x0b')
	})

	test('clears the submission-in-progress latch after a pre-request wallet disconnect', async () => {
		const createMarketTransaction = mock(async (_accountAddress: Address, _callbacks: { onTransactionSubmitted: (hash: Hash) => void }, _parameters: { questionData: { title: string } }) => ({
			createQuestionHash: '0xabc' as Hash,
			hash: '0xabc' as Hash,
			marketType: 'binary' as const,
			questionId: '0x0b',
		}))
		const loadZoltarQuestions = mock(async () => undefined)
		const setZoltarForkQuestionId = mock(() => undefined)
		const onTransactionRequested = mock(() => undefined)
		const dependencies: UseMarketCreationDependencies = {
			createMarket: createMarketTransaction,
		}
		mock.module('../../../features/universes/hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: mock(() => ({
				loadZoltarQuestions,
				setZoltarForkQuestionId,
			})),
		}))

		const { useMarketCreation } = await import(`../../../features/markets/hooks/useMarketCreation.js?case=${crypto.randomUUID()}`)
		let hookState: UseMarketCreationState | undefined
		const Harness = function MarketCreationHarness() {
			hookState = useMarketCreation(
				{
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
				},
				dependencies,
			)

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
		const createMarketTransaction = mock(async (_accountAddress: Address, _callbacks: { onTransactionSubmitted: (hash: Hash) => void }, parameters: { questionData: { title: string } }) => {
			return {
				createQuestionHash: '0xabc' as Hash,
				hash: '0xabc' as Hash,
				marketType: 'binary' as const,
				questionId: parameters.questionData.title === 'Question A' ? '0x0b' : '0x0c',
			}
		})
		const loadZoltarQuestions = mock(async () => undefined)
		const setZoltarForkQuestionId = mock(() => undefined)
		const dependencies: UseMarketCreationDependencies = {
			createMarket: createMarketTransaction,
		}
		mock.module('../../../features/universes/hooks/useZoltarOperations.js', () => ({
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

		const { useMarketCreation } = await import(`../../../features/markets/hooks/useMarketCreation.js?case=${crypto.randomUUID()}`)
		let hookState: UseMarketCreationState | undefined
		const Harness = function MarketCreationHarness() {
			hookState = useMarketCreation(
				{
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
				},
				dependencies,
			)

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
		expect(createMarketTransaction.mock.calls[0]?.[2].questionData.title).toBe('Question A')
		expect(loadZoltarQuestions).toHaveBeenCalledTimes(1)
		expect(setZoltarForkQuestionId).toHaveBeenCalledWith('0x0b')
	})

	test('keeps complete question drafts scoped by account and universe and clears a successful draft', async () => {
		const createMarketTransaction = mock(async (_accountAddress: Address, _callbacks: { onTransactionSubmitted: (hash: Hash) => void }, _parameters: { questionData: { title: string } }) => ({
			createQuestionHash: '0xabc' as Hash,
			hash: '0xabc' as Hash,
			marketType: 'scalar' as const,
			questionId: '0x0b',
		}))
		mock.module('../../../features/universes/hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: mock(() => ({
				loadZoltarQuestions: async () => undefined,
				setZoltarForkQuestionId: () => undefined,
			})),
		}))

		const { useMarketCreation } = await import(`../../../features/markets/hooks/useMarketCreation.js?case=${crypto.randomUUID()}`)
		let hookState: UseMarketCreationState | undefined
		let observedFormTitles: string[] = []
		const Harness = function MarketCreationHarness({ accountAddress, activeUniverseId }: { accountAddress: Address; activeUniverseId: bigint }) {
			hookState = useMarketCreation(
				{
					accountAddress,
					activeUniverseId,
					activeZoltarView: 'create',
					autoLoadInitialData: false,
					deploymentStatuses: [createStatus('zoltarQuestionData', true)],
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				{ createMarket: createMarketTransaction },
			)
			observedFormTitles.push(requireHookState(hookState).marketForm.title)

			return <div />
		}

		const scalarDraft: MarketFormState = {
			answerUnit: 'degrees C',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'Official station reading',
			endTime: '2026-08-02T00:00:00.000Z',
			marketType: 'scalar',
			scalarIncrement: '0.1',
			scalarMax: '60',
			scalarMin: '-20',
			startTime: '2026-08-01T00:00:00.000Z',
			title: 'Maximum temperature',
		}
		const categoricalDraft: MarketFormState = {
			answerUnit: '',
			categoricalOutcomes: ['Alpha', 'Beta', 'Gamma'],
			description: 'Published final result',
			endTime: '2026-09-02T00:00:00.000Z',
			marketType: 'categorical',
			scalarIncrement: '1',
			scalarMax: '100',
			scalarMin: '0',
			startTime: '2026-09-01T00:00:00.000Z',
			title: 'Which team wins?',
		}
		const renderedComponent = await renderIntoDocument(<Harness accountAddress={WALLET_ADDRESS} activeUniverseId={7n} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		await act(async () => {
			requireHookState(hookState).setMarketForm(() => scalarDraft)
		})

		observedFormTitles = []
		await act(async () => {
			render(<Harness accountAddress={SECOND_WALLET_ADDRESS} activeUniverseId={9n} />, renderedComponent.container)
		})
		expect(observedFormTitles.every(title => title === '')).toBe(true)
		await act(async () => {
			requireHookState(hookState).setMarketForm(() => categoricalDraft)
		})

		await act(async () => {
			render(<Harness accountAddress={WALLET_ADDRESS} activeUniverseId={7n} />, renderedComponent.container)
		})
		await waitFor(() => {
			expect(requireHookState(hookState).marketForm).toEqual(scalarDraft)
		})

		observedFormTitles = []
		await act(async () => {
			render(<Harness accountAddress={SECOND_WALLET_ADDRESS} activeUniverseId={9n} />, renderedComponent.container)
		})
		expect(observedFormTitles.every(title => title === categoricalDraft.title)).toBe(true)
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: SECOND_WALLET_ADDRESS }))
		await act(async () => {
			await requireHookState(hookState).createMarket()
		})
		expect(createMarketTransaction.mock.calls[0]?.[2].questionData.title).toBe(categoricalDraft.title)

		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
		await act(async () => {
			render(<Harness accountAddress={WALLET_ADDRESS} activeUniverseId={7n} />, renderedComponent.container)
		})
		expect(requireHookState(hookState).marketResult).toBeUndefined()
		expect(requireHookState(hookState).marketFeedback).toBeUndefined()

		await act(async () => {
			await requireHookState(hookState).createMarket()
		})
		await renderedComponent.cleanup()
		cleanupRenderedComponent = undefined

		hookState = undefined
		const remountedComponent = await renderIntoDocument(<Harness accountAddress={WALLET_ADDRESS} activeUniverseId={7n} />)
		cleanupRenderedComponent = remountedComponent.cleanup
		expect(requireHookState(hookState).marketForm.title).toBe('')

		await act(async () => {
			render(<Harness accountAddress={SECOND_WALLET_ADDRESS} activeUniverseId={9n} />, remountedComponent.container)
		})
		await waitFor(() => {
			expect(requireHookState(hookState).marketForm.title).toBe('')
		})
	})

	test('keeps another universe draft visible when an in-flight question succeeds in the original universe', async () => {
		const pendingCreate = createDeferred<MarketCreationResult & { hash: Hash }>()
		mock.module('../../../features/universes/hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: mock(() => ({
				loadZoltarQuestions: async () => undefined,
				setZoltarForkQuestionId: () => undefined,
			})),
		}))

		const { useMarketCreation } = await import(`../../../features/markets/hooks/useMarketCreation.js?case=${crypto.randomUUID()}`)
		let hookState: UseMarketCreationState | undefined
		const Harness = function MarketCreationHarness({ activeUniverseId }: { activeUniverseId: bigint }) {
			hookState = useMarketCreation(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId,
					activeZoltarView: 'create',
					autoLoadInitialData: false,
					deploymentStatuses: [createStatus('zoltarQuestionData', true)],
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
				},
				{ createMarket: async () => await pendingCreate.promise },
			)

			return <div />
		}
		const renderedComponent = await renderIntoDocument(<Harness activeUniverseId={7n} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		await act(async () => {
			requireHookState(hookState).setMarketForm(current => ({
				...current,
				endTime: '2026-10-02T00:00:00.000Z',
				title: 'Universe A question',
			}))
		})

		let createPromise: Promise<void> | undefined
		await act(() => {
			createPromise = requireHookState(hookState).createMarket()
		})
		await act(async () => {
			render(<Harness activeUniverseId={9n} />, renderedComponent.container)
			requireHookState(hookState).setMarketForm(current => ({ ...current, title: 'Unsent universe B draft' }))
		})
		expect(requireHookState(hookState).marketCreating).toBe(false)
		await act(async () => {
			render(<Harness activeUniverseId={7n} />, renderedComponent.container)
		})
		expect(requireHookState(hookState).marketCreating).toBe(true)
		await act(async () => {
			render(<Harness activeUniverseId={9n} />, renderedComponent.container)
		})

		pendingCreate.resolve({
			createQuestionHash: '0xabc',
			hash: '0xabc',
			marketType: 'binary',
			questionId: '0x0b',
		})
		await act(async () => {
			await createPromise
		})

		expect(requireHookState(hookState).marketForm.title).toBe('Unsent universe B draft')
		expect(requireHookState(hookState).marketResult).toBeUndefined()
		expect(requireHookState(hookState).marketFeedback).toBeUndefined()

		await act(async () => {
			render(<Harness activeUniverseId={7n} />, renderedComponent.container)
		})
		expect(requireHookState(hookState).marketResult?.questionId).toBe('0x0b')
		await act(async () => {
			render(<Harness activeUniverseId={9n} />, renderedComponent.container)
		})
		expect(requireHookState(hookState).marketForm.title).toBe('Unsent universe B draft')
	})

	test('ignores corrupt or unavailable question draft storage without blocking form use', async () => {
		mock.module('../../../features/universes/hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: mock(() => ({
				loadZoltarQuestions: async () => undefined,
				setZoltarForkQuestionId: () => undefined,
			})),
		}))

		window.sessionStorage.setItem(`zoltar.questionDraft:${WALLET_ADDRESS.toLowerCase()}:7`, '{invalid')
		const { useMarketCreation } = await import(`../../../features/markets/hooks/useMarketCreation.js?case=${crypto.randomUUID()}`)
		let hookState: UseMarketCreationState | undefined
		const Harness = function MarketCreationHarness() {
			hookState = useMarketCreation({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 7n,
				activeZoltarView: 'create',
				autoLoadInitialData: false,
				deploymentStatuses: [],
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
			})

			return <div />
		}
		const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(requireHookState(hookState).marketForm.title).toBe('')
		await act(async () => {
			requireHookState(hookState).setMarketForm(current => ({ ...current, title: 'Draft to reset' }))
			requireHookState(hookState).resetMarket()
		})
		expect(window.sessionStorage.getItem(`zoltar.questionDraft:${WALLET_ADDRESS.toLowerCase()}:7`)).toBeNull()
		await renderedComponent.cleanup()
		cleanupRenderedComponent = undefined
		hookState = undefined
		const remountedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = remountedComponent.cleanup
		expect(requireHookState(hookState).marketForm.title).toBe('')

		try {
			Object.defineProperty(window, 'sessionStorage', {
				configurable: true,
				get: () => {
					throw new DOMException('Storage unavailable', 'SecurityError')
				},
			})
			await act(async () => {
				requireHookState(hookState).setMarketForm(current => ({ ...current, title: 'Usable without storage' }))
			})
			expect(requireHookState(hookState).marketForm.title).toBe('Usable without storage')
		} finally {
			if (originalSessionStorageDescriptor !== undefined) Object.defineProperty(window, 'sessionStorage', originalSessionStorageDescriptor)
		}
	})
})

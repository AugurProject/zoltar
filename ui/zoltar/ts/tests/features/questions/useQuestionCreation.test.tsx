/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, zeroHash, type Address, type Hash } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { DeploymentStatus, MarketCreationResult } from '@zoltar/ui-core-shared/types/contracts.js'
import type { UseQuestionCreationDependencies } from '../../../features/questions/hooks/useQuestionCreation.js'
import type { CreateWriteClientCallbacks, TransactionRequestPreview } from '@zoltar/ui-core-shared/lib/chainBackend.js'

type UseQuestionCreation = typeof import('../../../features/questions/hooks/useQuestionCreation.js')['useQuestionCreation']
type UseQuestionCreationState = ReturnType<UseQuestionCreation>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a2')
const QUESTION_ID = `0x${'12'.repeat(32)}`
const CREATION_RESULT: MarketCreationResult & { hash: Hash } = {
	createQuestionHash: zeroHash,
	hash: zeroHash,
	marketType: 'binary',
	questionId: QUESTION_ID,
}
const DEPLOYED_QUESTION_DATA: DeploymentStatus = {
	address: zeroAddress,
	dependencies: [],
	deploy: async () => zeroHash,
	deployed: true,
	id: 'zoltarQuestionData',
	label: 'ZoltarQuestionData',
}

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve
	})
	return { promise, resolve }
}

function requireHookState(state: UseQuestionCreationState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

describe('useQuestionCreation', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreDomEnvironment: (() => void) | undefined
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

	async function renderHook(
		options: {
			accountAddress?: Address
			activeUniverseId?: bigint
			createQuestion?: UseQuestionCreationDependencies['createQuestion']
			deploymentStatuses?: DeploymentStatus[]
			environmentRefreshKey?: number
			loadZoltarQuestions?: () => Promise<void>
			onTransactionFinished?: () => void
			onTransactionRequested?: () => boolean | void
			refreshState?: () => Promise<void>
		} = {},
	) {
		const loadZoltarQuestions = mock(options.loadZoltarQuestions ?? (async () => undefined))
		const setZoltarForkQuestionId = mock(() => undefined)
		mock.module('../../../features/universes/hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: () => ({ loadZoltarQuestions, setZoltarForkQuestionId }),
		}))
		const { useQuestionCreation } = await import(`../../../features/questions/hooks/useQuestionCreation.js?case=${crypto.randomUUID()}`)
		const createQuestion = mock(options.createQuestion ?? (async () => CREATION_RESULT))
		const onTransactionFailed = mock(() => undefined)
		const onTransactionFinished = mock(options.onTransactionFinished ?? (() => undefined))
		const onTransactionPresented = mock(() => undefined)
		const onTransactionPrepared = mock(() => undefined)
		const onTransactionRequested = mock(options.onTransactionRequested ?? (() => undefined))
		const onTransactionSubmitted = mock(() => undefined)
		const refreshState = mock(options.refreshState ?? (async () => undefined))
		let hookState: UseQuestionCreationState | undefined
		const initialAccountAddress = options.accountAddress ?? WALLET_ADDRESS
		const Harness = function QuestionCreationHarness({ accountAddress, environmentRefreshKey }: { accountAddress: Address; environmentRefreshKey: number }) {
			hookState = useQuestionCreation(
				{
					accountAddress,
					activeUniverseId: options.activeUniverseId ?? 1n,
					activeZoltarView: 'questions',
					autoLoadInitialData: false,
					deploymentStatuses: options.deploymentStatuses ?? [DEPLOYED_QUESTION_DATA],
					environmentRefreshKey,
					onTransactionFailed,
					onTransactionFinished,
					onTransactionPresented,
					onTransactionPrepared,
					onTransactionRequested,
					onTransactionSubmitted,
					refreshState,
				},
				{ createQuestion },
			)
			return <div />
		}
		const rendered = await renderIntoDocument(h(Harness, { accountAddress: initialAccountAddress, environmentRefreshKey: options.environmentRefreshKey ?? 0 }))
		cleanupRenderedComponent = rendered.cleanup
		await act(async () => {
			requireHookState(hookState).setQuestionForm(current => ({ ...current, endTime: '2000', startTime: '1000', title: 'Will this work?' }))
		})
		const rerenderEnvironment = async (environmentRefreshKey: number) => {
			await act(async () => {
				render(h(Harness, { accountAddress: initialAccountAddress, environmentRefreshKey }), rendered.container)
				await Promise.resolve()
			})
		}
		const rerenderAccount = async (accountAddress: Address, environmentRefreshKey = options.environmentRefreshKey ?? 0) => {
			await act(async () => {
				render(h(Harness, { accountAddress, environmentRefreshKey }), rendered.container)
				await Promise.resolve()
			})
		}
		const remount = async (environmentRefreshKey: number) => {
			await rendered.cleanup()
			cleanupRenderedComponent = undefined
			hookState = undefined
			const remounted = await renderIntoDocument(h(Harness, { accountAddress: initialAccountAddress, environmentRefreshKey }))
			cleanupRenderedComponent = remounted.cleanup
		}
		return {
			createQuestion,
			hookState: () => requireHookState(hookState),
			loadZoltarQuestions,
			onTransactionFailed,
			onTransactionFinished,
			onTransactionPrepared,
			onTransactionPresented,
			onTransactionRequested,
			onTransactionSubmitted,
			refreshState,
			remount,
			rerenderAccount,
			rerenderEnvironment,
			setZoltarForkQuestionId,
		}
	}

	test('records a successful creation, selects it for a fork, and refreshes state', async () => {
		const harness = await renderHook()
		await act(async () => await harness.hookState().createQuestion())
		expect(harness.createQuestion).toHaveBeenCalledTimes(1)
		expect(harness.hookState().questionResult).toEqual(CREATION_RESULT)
		expect(harness.hookState().questionFeedback?.status.tone).toBe('success')
		expect(harness.setZoltarForkQuestionId).toHaveBeenCalledWith(QUESTION_ID)
		expect(harness.refreshState).toHaveBeenCalledTimes(1)
		expect(harness.loadZoltarQuestions).toHaveBeenCalledTimes(1)
		expect(harness.onTransactionPresented).toHaveBeenCalledTimes(1)
		expect(harness.onTransactionRequested.mock.calls[0]?.[0].universeId).toBeUndefined()
		expect(harness.onTransactionPresented.mock.calls[0]?.[0].universeId).toBeUndefined()
	})

	test('reports write failures and missing deployment prerequisites', async () => {
		const failed = await renderHook({
			createQuestion: async () => {
				throw new Error('wallet rejected')
			},
		})
		await act(async () => await failed.hookState().createQuestion())
		expect(failed.hookState().questionFeedback?.status.tone).toBe('error')
		expect(failed.onTransactionFailed.mock.calls[0]?.[0]).toContain('wallet rejected')
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		const missing = await renderHook({ deploymentStatuses: [] })
		await act(async () => await missing.hookState().createQuestion())
		expect(missing.createQuestion).not.toHaveBeenCalled()
		expect(missing.hookState().questionFeedback?.status.detail).toContain('Deploy ZoltarQuestionData')
	})

	test('does not execute or finish a question transaction rejected by the global admission gate', async () => {
		const harness = await renderHook({ onTransactionRequested: () => false })

		await act(async () => await harness.hookState().createQuestion())

		expect(harness.createQuestion).not.toHaveBeenCalled()
		expect(harness.onTransactionPrepared).not.toHaveBeenCalled()
		expect(harness.onTransactionSubmitted).not.toHaveBeenCalled()
		expect(harness.onTransactionFinished).not.toHaveBeenCalled()
		expect(harness.hookState().questionCreating).toBe(false)
		expect(harness.hookState().questionError).toBe('Finish the current transaction before starting another transaction.')
	})

	test('keeps the successful result and presents a warning when refresh fails', async () => {
		const harness = await renderHook({
			loadZoltarQuestions: async () => {
				throw new Error('question refresh unavailable')
			},
		})
		await act(async () => await harness.hookState().createQuestion())
		expect(harness.hookState().questionResult).toEqual(CREATION_RESULT)
		expect(harness.hookState().questionFeedback?.status.tone).toBe('warning')
		expect(harness.hookState().questionFeedback?.status.detail).toContain('question refresh unavailable')
		expect(harness.onTransactionPresented).toHaveBeenCalledTimes(2)
	})

	test('rejects duplicate submissions and releases the lock after completion', async () => {
		const deferred = createDeferred<MarketCreationResult & { hash: Hash }>()
		const harness = await renderHook({ createQuestion: async () => await deferred.promise })
		let firstSubmission = Promise.resolve()
		await act(async () => {
			firstSubmission = harness.hookState().createQuestion()
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(harness.createQuestion).toHaveBeenCalledTimes(1)
		await act(async () => await harness.hookState().createQuestion())
		expect(harness.createQuestion).toHaveBeenCalledTimes(1)
		expect(harness.hookState().questionError).toBe('Question creation already in progress')
		await act(async () => {
			deferred.resolve(CREATION_RESULT)
			await firstSubmission
		})
		expect(harness.onTransactionFinished).toHaveBeenCalledTimes(1)
	})

	test('reset clears the form and owner-scoped result state', async () => {
		const harness = await renderHook()
		await act(async () => await harness.hookState().createQuestion())
		await act(async () => harness.hookState().resetQuestion())
		expect(harness.hookState().questionForm.title).toBe('')
		expect(harness.hookState().questionResult).toBeUndefined()
		expect(harness.hookState().questionError).toBeUndefined()
	})

	test('hides completed transaction state after the environment changes', async () => {
		const harness = await renderHook()
		await act(async () => await harness.hookState().createQuestion())
		expect(harness.hookState().questionResult).toEqual(CREATION_RESULT)
		expect(harness.hookState().questionFeedback?.status.tone).toBe('success')

		await harness.rerenderEnvironment(1)

		expect(harness.hookState().questionResult).toBeUndefined()
		expect(harness.hookState().questionFeedback).toBeUndefined()
		expect(harness.hookState().questionError).toBeUndefined()
	})

	test('does not present a deferred completion in a different environment', async () => {
		const deferred = createDeferred<MarketCreationResult & { hash: Hash }>()
		let submittedCallbacks: CreateWriteClientCallbacks | undefined
		const harness = await renderHook({
			createQuestion: async (_accountAddress, callbacks) => {
				submittedCallbacks = callbacks
				return await deferred.promise
			},
		})
		let submission = Promise.resolve()
		await act(async () => {
			submission = harness.hookState().createQuestion()
			await Promise.resolve()
			await Promise.resolve()
		})
		await harness.rerenderEnvironment(1)
		const preparedPreview: TransactionRequestPreview = { account: WALLET_ADDRESS, args: [], chainName: 'replacement test', functionName: 'createMarket', value: 0n }
		submittedCallbacks?.onTransactionPrepared?.(preparedPreview)
		submittedCallbacks?.onTransactionSubmitted?.(zeroHash)

		await act(async () => {
			deferred.resolve(CREATION_RESULT)
			await submission
		})

		expect(harness.hookState().questionResult).toBeUndefined()
		expect(harness.hookState().questionFeedback).toBeUndefined()
		expect(harness.onTransactionPresented).not.toHaveBeenCalled()
		expect(harness.onTransactionPrepared).not.toHaveBeenCalled()
		expect(harness.onTransactionSubmitted).not.toHaveBeenCalled()
		expect(harness.onTransactionFinished).toHaveBeenCalledTimes(1)
		expect(harness.refreshState).not.toHaveBeenCalled()
		expect(harness.loadZoltarQuestions).not.toHaveBeenCalled()
		expect(harness.setZoltarForkQuestionId).not.toHaveBeenCalled()
	})

	test('allows a replacement environment submission without letting the old completion unlock it', async () => {
		const firstDeferred = createDeferred<MarketCreationResult & { hash: Hash }>()
		const secondDeferred = createDeferred<MarketCreationResult & { hash: Hash }>()
		let requestCount = 0
		const harness = await renderHook({
			createQuestion: async () => {
				requestCount += 1
				return await (requestCount === 1 ? firstDeferred.promise : secondDeferred.promise)
			},
		})
		let firstSubmission = Promise.resolve()
		await act(async () => {
			firstSubmission = harness.hookState().createQuestion()
			await Promise.resolve()
			await Promise.resolve()
		})
		await harness.rerenderEnvironment(1)
		let secondSubmission = Promise.resolve()
		await act(async () => {
			secondSubmission = harness.hookState().createQuestion()
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(requestCount).toBe(2)
		expect(harness.hookState().questionCreating).toBe(true)

		await act(async () => {
			firstDeferred.resolve(CREATION_RESULT)
			await firstSubmission
		})
		expect(harness.hookState().questionCreating).toBe(true)
		expect(harness.hookState().questionResult).toBeUndefined()

		await act(async () => {
			secondDeferred.resolve(CREATION_RESULT)
			await secondSubmission
		})
		expect(harness.hookState().questionCreating).toBe(false)
		expect(harness.hookState().questionResult).toEqual(CREATION_RESULT)
	})

	test('releases global transaction ownership after the submitting account changes', async () => {
		const firstDeferred = createDeferred<MarketCreationResult & { hash: Hash }>()
		let requestCount = 0
		let transactionInFlight = false
		const harness = await renderHook({
			createQuestion: async () => {
				requestCount += 1
				return requestCount === 1 ? await firstDeferred.promise : CREATION_RESULT
			},
			onTransactionFinished: () => {
				transactionInFlight = false
			},
			onTransactionRequested: () => {
				if (transactionInFlight) return false
				transactionInFlight = true
				return true
			},
		})
		let firstSubmission = Promise.resolve()
		await act(async () => {
			firstSubmission = harness.hookState().createQuestion()
			await Promise.resolve()
			await Promise.resolve()
		})

		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))
		await harness.rerenderAccount(NEXT_WALLET_ADDRESS)
		await act(async () => {
			harness.hookState().setQuestionForm(current => ({ ...current, endTime: '2000', startTime: '1000', title: 'Will the replacement account submit?' }))
		})
		await act(async () => await harness.hookState().createQuestion())
		expect(harness.hookState().questionError).toBe('Finish the current transaction before starting another transaction.')
		expect(requestCount).toBe(1)

		await act(async () => {
			firstDeferred.resolve(CREATION_RESULT)
			await firstSubmission
		})
		expect(transactionInFlight).toBe(false)

		await act(async () => await harness.hookState().createQuestion())
		expect(harness.hookState().questionError).toBeUndefined()
		expect(requestCount).toBe(2)
		expect(harness.hookState().questionResult).toEqual(CREATION_RESULT)
	})

	test('does not erase a newer account draft when an older submission completes', async () => {
		const deferred = createDeferred<MarketCreationResult & { hash: Hash }>()
		const harness = await renderHook({ createQuestion: async () => await deferred.promise })
		let submission = Promise.resolve()
		await act(async () => {
			submission = harness.hookState().createQuestion()
			await Promise.resolve()
			await Promise.resolve()
		})
		await act(async () => {
			harness.hookState().setQuestionForm(current => ({ ...current, title: 'Newer draft' }))
			deferred.resolve(CREATION_RESULT)
			await submission
		})

		await harness.remount(0)
		expect(harness.hookState().questionForm.title).toBe('Newer draft')
	})

	test('keeps global question drafts across universe changes and isolates them by account', async () => {
		mock.module('../../../features/universes/hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: () => ({ loadZoltarQuestions: async () => undefined, setZoltarForkQuestionId: () => undefined }),
		}))
		const { useQuestionCreation } = await import(`../../../features/questions/hooks/useQuestionCreation.js?case=${crypto.randomUUID()}`)
		let hookState: UseQuestionCreationState | undefined
		const Harness = function QuestionDraftHarness({ accountAddress, activeUniverseId }: { accountAddress: typeof WALLET_ADDRESS; activeUniverseId: bigint }) {
			hookState = useQuestionCreation({
				accountAddress,
				activeUniverseId,
				activeZoltarView: 'questions',
				autoLoadInitialData: false,
				deploymentStatuses: [DEPLOYED_QUESTION_DATA],
				environmentRefreshKey: 0,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
			})
			return <div />
		}
		const rendered = await renderIntoDocument(h(Harness, { accountAddress: WALLET_ADDRESS, activeUniverseId: 1n }))
		cleanupRenderedComponent = rendered.cleanup
		await act(async () => requireHookState(hookState).setQuestionForm(current => ({ ...current, title: 'Owner one draft' })))
		await act(async () => {
			render(h(Harness, { accountAddress: WALLET_ADDRESS, activeUniverseId: 2n }), rendered.container)
			await Promise.resolve()
		})
		expect(requireHookState(hookState).questionForm.title).toBe('Owner one draft')
		await act(async () => {
			render(h(Harness, { accountAddress: NEXT_WALLET_ADDRESS, activeUniverseId: 1n }), rendered.container)
			await Promise.resolve()
		})
		expect(requireHookState(hookState).questionForm.title).toBe('')
	})
})

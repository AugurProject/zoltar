/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, type Hash, zeroAddress } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { useZoltarFork } from '../hooks/useZoltarFork.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import type { MarketDetails, ZoltarUniverseSummary } from '../types/contracts.js'

type UseZoltarForkState = ReturnType<typeof useZoltarFork>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkThreshold: 100n,
		forkQuestionDetails: undefined,
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: false,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupply: 1000n,
		universeId: 1n,
		...overrides,
	}
}

function createForkQuestion(questionId: string): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Fork question',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId,
		startTime: 1n,
		title: 'Will this fork?',
	}
}

function requireHookState(state: UseZoltarForkState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

	return state
}

describe('useZoltarFork', () => {
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

	test('does not request a fork transaction when the active wallet account changed', async () => {
		const ensureZoltarUniverse = mock(async () => createUniverse())
		const onTransactionRequested = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)
		let hookState: UseZoltarForkState | undefined
		const Harness = function ZoltarForkHarness() {
			hookState = useZoltarFork({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 1n,
				ensureZoltarUniverse,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				refreshZoltarUniverse: async () => undefined,
				shouldAutoLoadForkAccess: false,
				zoltarUniverse: createUniverse(),
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).forkZoltar()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(ensureZoltarUniverse).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Wallet account changed. Review the action with the connected account and try again')
	})

	test('forkZoltar snapshots the submitted question id before universe preflight resolves', async () => {
		const universeLoad = createDeferred<ZoltarUniverseSummary>()
		const forkZoltarUniverse = mock(async (_client: unknown, universeId: bigint, questionId: bigint) => {
			expect(universeId).toBe(1n)
			expect(questionId).toBe(11n)
			return {
				action: 'forkZoltar' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ab' as Hash,
				questionId: `0x${questionId.toString(16)}`,
				universeId,
			}
		})

		mock.module('../contracts.js', () => ({
			approveErc20: mock(async () => {
				throw new Error('approveErc20 should not be called in this test')
			}),
			forkZoltarUniverse,
			getZoltarAddress: mock(() => zeroAddress),
			readOptionalMulticall: mock(async () => []),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))

		const { useZoltarFork } = await import(`../hooks/useZoltarFork.js?case=${crypto.randomUUID()}`)
		let hookState: UseZoltarForkState | undefined
		const Harness = function ZoltarForkHarness() {
			hookState = useZoltarFork({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 1n,
				ensureZoltarUniverse: async () => await universeLoad.promise,
				onTransactionFailed: () => undefined,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				refreshZoltarUniverse: async () => undefined,
				shouldAutoLoadForkAccess: false,
				zoltarUniverse: createUniverse(),
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setZoltarForkQuestionId('0x0b')
		})

		let forkPromise = Promise.resolve()
		await act(() => {
			forkPromise = requireHookState(hookState).forkZoltar()
		})

		await act(async () => {
			requireHookState(hookState).setZoltarForkQuestionId('0x0c')
		})

		await act(async () => {
			universeLoad.resolve(createUniverse())
			await forkPromise
		})

		expect(forkZoltarUniverse).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).zoltarForkFeedback?.status.tone).toBe('success')
		expect(requireHookState(hookState).zoltarForkResult?.questionId).toBe('0xb')
	})

	test('approveZoltarForkRep ignores malformed submitted question input and uses loaded universe details', async () => {
		const approveErc20 = mock(async () => ({
			hash: '0x00000000000000000000000000000000000000000000000000000000000000ac' as Hash,
		}))

		mock.module('../contracts.js', () => ({
			approveErc20,
			forkZoltarUniverse: mock(async () => {
				throw new Error('forkZoltarUniverse should not be called in this test')
			}),
			getZoltarAddress: mock(() => zeroAddress),
			readOptionalMulticall: mock(async () => []),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({ kind: 'read-client' })),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))

		const { useZoltarFork } = await import(`../hooks/useZoltarFork.js?case=${crypto.randomUUID()}`)
		let hookState: UseZoltarForkState | undefined
		const Harness = function ZoltarForkHarness() {
			hookState = useZoltarFork({
				accountAddress: WALLET_ADDRESS,
				activeUniverseId: 1n,
				ensureZoltarUniverse: async () => createUniverse({ forkQuestionDetails: createForkQuestion('0x0d') }),
				onTransactionFailed: () => undefined,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				refreshState: async () => undefined,
				refreshZoltarUniverse: async () => undefined,
				shouldAutoLoadForkAccess: false,
				zoltarUniverse: createUniverse({ forkQuestionDetails: createForkQuestion('0x0d') }),
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setZoltarForkQuestionId('not-a-question-id')
		})

		await act(async () => {
			await requireHookState(hookState).approveZoltarForkRep()
		})

		expect(approveErc20).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).zoltarForkFeedback?.status.tone).toBe('success')
		expect(requireHookState(hookState).zoltarForkResult?.questionId).toBe('0xd')
	})
})

/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { type Address, getAddress, type Hash, zeroAddress } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { useZoltarFork, type UseZoltarForkDependencies } from '../../../features/universes/hooks/useZoltarFork.js'
import { createFakeBackend } from '../../testUtils/fakeBackend.js'
import { installDomEnvironment } from '../../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../../testUtils/renderIntoDocument.js'
import type { MarketDetails, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

type UseZoltarForkState = ReturnType<typeof useZoltarFork>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')
const REPUTATION_TOKEN_ADDRESS = getAddress('0x00000000000000000000000000000000000000c3')

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
		forkThresholdAttoRep: 100n,
		forkQuestionDetails: undefined,
		forkTime: 1n,
		forkingOutcomeIndex: 0n,
		hasForked: false,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 1000n,
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

function createZoltarForkDependencies(overrides: Partial<UseZoltarForkDependencies> = {}): UseZoltarForkDependencies {
	return {
		approveForkRep: async () => {
			throw new Error('approveForkRep should not be called in this test')
		},
		forkZoltarUniverse: async () => {
			throw new Error('forkZoltarUniverse should not be called in this test')
		},
		loadZoltarForkAccess: async () => {
			throw new Error('loadZoltarForkAccess should not be called in this test')
		},
		...overrides,
	}
}

function createForkAccessResults() {
	return [
		{ result: 100n, status: 'success' as const },
		{ result: 0n, status: 'success' as const },
		{ result: 0n, status: 'success' as const },
	]
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
			hookState = useZoltarFork(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					environmentRefreshKey: 0,
					ensureZoltarUniverse,
					onTransactionFailed,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					refreshZoltarUniverse: async () => undefined,
					shouldAutoLoadForkAccess: false,
					zoltarUniverse: createUniverse({ reputationToken: REPUTATION_TOKEN_ADDRESS }),
				},
				createZoltarForkDependencies(),
			)

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

	test('scopes mutable pre-fork question selection by account, environment, and universe', async () => {
		let hookState: UseZoltarForkState | undefined
		const Harness = function ZoltarForkHarness({ accountAddress, activeUniverseId, environmentRefreshKey }: { accountAddress: Address | undefined; activeUniverseId: bigint; environmentRefreshKey: number }) {
			hookState = useZoltarFork(
				{
					accountAddress,
					activeUniverseId,
					environmentRefreshKey,
					ensureZoltarUniverse: async () => createUniverse({ universeId: activeUniverseId }),
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					refreshZoltarUniverse: async () => undefined,
					shouldAutoLoadForkAccess: false,
					zoltarUniverse: createUniverse({ universeId: activeUniverseId }),
				},
				createZoltarForkDependencies(),
			)

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, { accountAddress: WALLET_ADDRESS, activeUniverseId: 1n, environmentRefreshKey: 0 }))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setZoltarForkQuestionId('0x01')
		})
		expect(requireHookState(hookState).zoltarForkQuestionId).toBe('0x01')

		await act(async () => {
			render(h(Harness, { accountAddress: WALLET_ADDRESS, activeUniverseId: 2n, environmentRefreshKey: 0 }), renderedComponent.container)
		})
		expect(requireHookState(hookState).zoltarForkQuestionId).toBe('')

		await act(async () => {
			requireHookState(hookState).setZoltarForkQuestionId('0x02')
			render(h(Harness, { accountAddress: WALLET_ADDRESS, activeUniverseId: 2n, environmentRefreshKey: 1 }), renderedComponent.container)
		})
		expect(requireHookState(hookState).zoltarForkQuestionId).toBe('')

		await act(async () => {
			requireHookState(hookState).setZoltarForkQuestionId('0x03')
			render(h(Harness, { accountAddress: NEXT_WALLET_ADDRESS, activeUniverseId: 2n, environmentRefreshKey: 1 }), renderedComponent.container)
		})
		expect(requireHookState(hookState).zoltarForkQuestionId).toBe('')
	})

	test('forkZoltar snapshots the submitted question id before universe preflight resolves', async () => {
		const universeLoad = createDeferred<ZoltarUniverseSummary>()
		const forkZoltarUniverse = mock(async (_accountAddress: string, _callbacks: unknown, universeId: bigint, questionId: bigint) => {
			expect(universeId).toBe(1n)
			expect(questionId).toBe(11n)
			return {
				action: 'forkZoltar' as const,
				hash: '0x00000000000000000000000000000000000000000000000000000000000000ab' as Hash,
				questionId: `0x${questionId.toString(16)}`,
				universeId,
			}
		})
		const loadZoltarForkAccess = mock(async () => createForkAccessResults())
		const dependencies = createZoltarForkDependencies({ forkZoltarUniverse, loadZoltarForkAccess })

		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))

		let hookState: UseZoltarForkState | undefined
		const Harness = function ZoltarForkHarness() {
			hookState = useZoltarFork(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					environmentRefreshKey: 0,
					ensureZoltarUniverse: async () => await universeLoad.promise,
					onTransactionFailed: () => undefined,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					refreshZoltarUniverse: async () => undefined,
					shouldAutoLoadForkAccess: false,
					zoltarUniverse: createUniverse({ reputationToken: REPUTATION_TOKEN_ADDRESS }),
				},
				dependencies,
			)

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
			universeLoad.resolve(createUniverse({ reputationToken: REPUTATION_TOKEN_ADDRESS }))
			await forkPromise
		})

		expect(forkZoltarUniverse).toHaveBeenCalledTimes(1)
		expect(loadZoltarForkAccess).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).zoltarForkFeedback?.status.tone).toBe('success')
		expect(requireHookState(hookState).zoltarForkResult?.questionId).toBe('0xb')
	})

	test('approveZoltarForkRep uses the submitted question before the universe has forked', async () => {
		const approveForkRep = mock(async (_accountAddress: string, _callbacks: { onTransactionSubmitted: (hash: Hash) => void }, _reputationToken: string, _amount: bigint, questionId: bigint, universeId: bigint) => ({
			action: 'approveForkRep' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000ac' as Hash,
			questionId: `0x${questionId.toString(16)}`,
			universeId,
		}))
		const loadZoltarForkAccess = mock(async () => createForkAccessResults())
		const dependencies = createZoltarForkDependencies({
			approveForkRep,
			loadZoltarForkAccess,
		})

		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))

		let hookState: UseZoltarForkState | undefined
		const Harness = function ZoltarForkHarness() {
			hookState = useZoltarFork(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					environmentRefreshKey: 0,
					ensureZoltarUniverse: async () => createUniverse({ reputationToken: REPUTATION_TOKEN_ADDRESS }),
					onTransactionFailed: () => undefined,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					refreshZoltarUniverse: async () => undefined,
					shouldAutoLoadForkAccess: false,
					zoltarUniverse: createUniverse({ reputationToken: REPUTATION_TOKEN_ADDRESS }),
				},
				dependencies,
			)

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			requireHookState(hookState).setZoltarForkQuestionId('0x0e')
		})

		await act(async () => {
			await requireHookState(hookState).approveZoltarForkRep()
		})

		expect(approveForkRep).toHaveBeenCalledTimes(1)
		const approveCall = approveForkRep.mock.calls[0]
		if (approveCall === undefined) throw new Error('Expected approveForkRep call')
		expect(approveCall[0]).toBe(WALLET_ADDRESS)
		expect(typeof approveCall[1].onTransactionSubmitted).toBe('function')
		expect(approveCall[2]).toBe(REPUTATION_TOKEN_ADDRESS)
		expect(approveCall[3]).toBe(100n)
		expect(approveCall[4]).toBe(14n)
		expect(approveCall[5]).toBe(1n)
		expect(loadZoltarForkAccess).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).zoltarForkFeedback?.status.tone).toBe('success')
		expect(requireHookState(hookState).zoltarForkResult?.questionId).toBe('0xe')
	})

	test('approveZoltarForkRep uses loaded fork details after a post-fork reload', async () => {
		const approveForkRep = mock(async (_accountAddress: string, _callbacks: { onTransactionSubmitted: (hash: Hash) => void }, _reputationToken: string, _amount: bigint, questionId: bigint, universeId: bigint) => ({
			action: 'approveForkRep' as const,
			hash: '0x00000000000000000000000000000000000000000000000000000000000000ad' as Hash,
			questionId: `0x${questionId.toString(16)}`,
			universeId,
		}))
		const loadZoltarForkAccess = mock(async () => createForkAccessResults())
		const dependencies = createZoltarForkDependencies({
			approveForkRep,
			loadZoltarForkAccess,
		})
		const forkedUniverse = createUniverse({
			forkQuestionDetails: createForkQuestion('0x0f'),
			hasForked: true,
			reputationToken: REPUTATION_TOKEN_ADDRESS,
		})

		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))

		let hookState: UseZoltarForkState | undefined
		const Harness = function ZoltarForkHarness() {
			hookState = useZoltarFork(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					environmentRefreshKey: 0,
					ensureZoltarUniverse: async () => forkedUniverse,
					onTransactionFailed: () => undefined,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					refreshZoltarUniverse: async () => undefined,
					shouldAutoLoadForkAccess: false,
					zoltarUniverse: forkedUniverse,
				},
				dependencies,
			)

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(requireHookState(hookState).zoltarForkQuestionId).toBe('')

		await act(async () => {
			await requireHookState(hookState).approveZoltarForkRep()
		})

		expect(approveForkRep).toHaveBeenCalledTimes(1)
		const approveCall = approveForkRep.mock.calls[0]
		if (approveCall === undefined) throw new Error('Expected approveForkRep call')
		expect(approveCall[4]).toBe(15n)
		expect(approveCall[5]).toBe(1n)
		expect(loadZoltarForkAccess).toHaveBeenCalledTimes(1)
		expect(requireHookState(hookState).zoltarForkFeedback?.status.tone).toBe('success')
		expect(requireHookState(hookState).zoltarForkResult?.questionId).toBe('0xf')
	})

	test('reloads child REP access when a split deploys an existing child universe id', async () => {
		const childUniverse = {
			exists: false,
			forkTime: 1n,
			outcomeIndex: 1n,
			outcomeLabel: 'Yes',
			parentUniverseId: 1n,
			reputationToken: zeroAddress,
			universeId: 2n,
		}
		const deployedChildUniverse = {
			...childUniverse,
			exists: true,
			reputationToken: getAddress('0x00000000000000000000000000000000000000d4'),
		}
		const loadZoltarForkAccess = mock(async (_accountAddress: string, _reputationToken: string, _universeId: bigint, childUniverses: ZoltarUniverseSummary['childUniverses']) => [...createForkAccessResults(), ...childUniverses.map(() => ({ result: 10n, status: 'success' as const }))])
		const dependencies = createZoltarForkDependencies({ loadZoltarForkAccess })
		const createForkedUniverse = (child: ZoltarUniverseSummary['childUniverses'][number]) =>
			createUniverse({
				childUniverses: [child],
				hasForked: true,
				reputationToken: REPUTATION_TOKEN_ADDRESS,
			})

		let hookState: UseZoltarForkState | undefined
		const Harness = function ZoltarForkHarness({ universe }: { universe: ZoltarUniverseSummary }) {
			hookState = useZoltarFork(
				{
					accountAddress: WALLET_ADDRESS,
					activeUniverseId: 1n,
					environmentRefreshKey: 0,
					ensureZoltarUniverse: async () => universe,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					refreshZoltarUniverse: async () => undefined,
					shouldAutoLoadForkAccess: true,
					zoltarUniverse: universe,
				},
				dependencies,
			)

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, { universe: createForkedUniverse(childUniverse) }))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await Promise.resolve()
		})
		expect(loadZoltarForkAccess).toHaveBeenCalledTimes(1)

		await act(async () => {
			render(h(Harness, { universe: createForkedUniverse(deployedChildUniverse) }), renderedComponent.container)
		})
		await act(async () => {
			await Promise.resolve()
		})

		expect(loadZoltarForkAccess).toHaveBeenCalledTimes(2)
		expect(loadZoltarForkAccess.mock.calls[1]?.[3]).toEqual([deployedChildUniverse])
		expect(requireHookState(hookState).zoltarMigrationChildRepBalancesAttoRep).toEqual({ '2': 10n })
	})

	test('drops another accounts child REP balance when the replacement read fails', async () => {
		const childUniverse = {
			exists: true,
			forkTime: 1n,
			outcomeIndex: 1n,
			outcomeLabel: 'Yes',
			parentUniverseId: 1n,
			reputationToken: getAddress('0x00000000000000000000000000000000000000d4'),
			universeId: 2n,
		}
		const universe = createUniverse({
			childUniverses: [childUniverse],
			hasForked: true,
			reputationToken: REPUTATION_TOKEN_ADDRESS,
		})
		const loadZoltarForkAccess = mock(async (accountAddress: string) => {
			if (accountAddress === WALLET_ADDRESS) return [...createForkAccessResults(), { result: 10n, status: 'success' as const }]
			return [...createForkAccessResults(), { error: new Error('Child balance unavailable'), status: 'failure' as const }]
		})
		const dependencies = createZoltarForkDependencies({ loadZoltarForkAccess })
		let hookState: UseZoltarForkState | undefined
		const Harness = function ZoltarForkHarness({ accountAddress }: { accountAddress: Address }) {
			hookState = useZoltarFork(
				{
					accountAddress,
					activeUniverseId: 1n,
					environmentRefreshKey: 0,
					ensureZoltarUniverse: async () => universe,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					refreshZoltarUniverse: async () => undefined,
					shouldAutoLoadForkAccess: false,
					zoltarUniverse: universe,
				},
				dependencies,
			)

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, { accountAddress: WALLET_ADDRESS }))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).loadZoltarForkAccess()
		})
		expect(requireHookState(hookState).zoltarMigrationChildRepBalancesAttoRep).toEqual({ '2': 10n })

		render(h(Harness, { accountAddress: NEXT_WALLET_ADDRESS }), renderedComponent.container)
		expect(requireHookState(hookState).zoltarMigrationChildRepBalancesAttoRep).toEqual({})
		await act(async () => {
			await requireHookState(hookState).loadZoltarForkAccess()
		})

		expect(loadZoltarForkAccess.mock.calls[1]?.[0]).toBe(NEXT_WALLET_ADDRESS)
		expect(requireHookState(hookState).zoltarMigrationChildRepBalancesAttoRep).toEqual({})
	})

	test('keeps fork access cleared when an earlier account load resolves after disconnect', async () => {
		const deferred = createDeferred<ReturnType<typeof createForkAccessResults>>()
		const loadZoltarForkAccess = mock(async () => await deferred.promise)
		const dependencies = createZoltarForkDependencies({ loadZoltarForkAccess })
		const universe = createUniverse({
			hasForked: true,
			reputationToken: REPUTATION_TOKEN_ADDRESS,
		})
		let hookState: UseZoltarForkState | undefined
		const Harness = function ZoltarForkHarness({ accountAddress }: { accountAddress: Address | undefined }) {
			hookState = useZoltarFork(
				{
					accountAddress,
					activeUniverseId: 1n,
					environmentRefreshKey: 0,
					ensureZoltarUniverse: async () => universe,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					refreshZoltarUniverse: async () => undefined,
					shouldAutoLoadForkAccess: false,
					zoltarUniverse: universe,
				},
				dependencies,
			)

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, { accountAddress: WALLET_ADDRESS }))
		cleanupRenderedComponent = renderedComponent.cleanup
		const pendingLoad = requireHookState(hookState).loadZoltarForkAccess()
		await act(async () => {
			await Promise.resolve()
		})

		render(h(Harness, { accountAddress: undefined }), renderedComponent.container)
		expect(requireHookState(hookState).zoltarMigrationChildRepBalancesAttoRep).toEqual({})

		await act(async () => {
			deferred.resolve(createForkAccessResults())
			await pendingLoad
		})

		await act(async () => {
			await requireHookState(hookState).loadZoltarForkAccess()
		})

		const state = requireHookState(hookState)
		expect(state.zoltarForkApproval.value).toBeUndefined()
		expect(state.zoltarForkRepBalanceAttoRep).toBeUndefined()
		expect(state.zoltarMigrationPreparedRepBalanceAttoRep).toBeUndefined()
		expect(state.zoltarMigrationChildRepBalancesAttoRep).toEqual({})
	})
})

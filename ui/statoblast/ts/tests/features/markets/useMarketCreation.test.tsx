/// <reference types='bun-types' />

import { getAddress, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installModuleMocks } from '@zoltar/ui-core-shared/tests/testUtils/moduleMocks.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { DeploymentStatus, MarketCreationResult } from '@zoltar/ui-core-shared/types/contracts.js'
import type { UseMarketCreationDependencies } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useMarketCreation.js'
import type { UseQuestionCreationParameters } from '@zoltar/ui-zoltar-shared/features/questions/hooks/useQuestionCreation.js'
import type { MarketFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

// The Zoltar hook tests own the shared submission, admission, and environment-replacement behavior. These tests cover
// the Statoblast adapter: universe-scoped drafts, the forced binary type, `refreshQuestionList`, and the returned result.
type UseMarketCreation = typeof import('@zoltar/ui-statoblast-shared/features/markets/hooks/useMarketCreation.js')['useMarketCreation']
type UseMarketCreationState = ReturnType<UseMarketCreation>
type CreateMarket = UseMarketCreationDependencies['createMarket']
type CreatedMarket = MarketCreationResult & { hash: Hash }
type HarnessProps = { accountAddress?: Address | undefined; activeUniverseId?: bigint; environmentRefreshKey?: number }

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const SECOND_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a2')
const ANONYMOUS_DRAFT_KEY = 'zoltar.questionDraft:anonymous:7'
const OWNER_DRAFT_KEY = `zoltar.questionDraft:${WALLET_ADDRESS.toLowerCase()}:7`
const CREATED_MARKET: CreatedMarket = { createQuestionHash: '0xabc', hash: '0xabc', marketType: 'binary', questionId: '0x0b' }
const DEPLOYED_QUESTION_DATA: DeploymentStatus = {
	address: getAddress('0x00000000000000000000000000000000000000d1'),
	dependencies: [],
	deploy: async () => '0x0',
	deployed: true,
	id: 'zoltarQuestionData',
	label: 'zoltarQuestionData',
}

function withSessionStorage(storage: () => Storage, run: () => Promise<void>) {
	const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
	Object.defineProperty(window, 'sessionStorage', { configurable: true, get: storage })
	return run().finally(() => {
		if (originalSessionStorageDescriptor !== undefined) Object.defineProperty(window, 'sessionStorage', originalSessionStorageDescriptor)
	})
}

describe('useMarketCreation', () => {
	const moduleMocks = installModuleMocks(specifier => import.meta.resolve(specifier))

	const { replaceEnvironment, trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: WALLET_ADDRESS })

	async function renderMarketCreationHook(
		options: {
			createMarket?: CreateMarket
			initialProps?: HarnessProps
			onRender?: (state: UseMarketCreationState) => void
			parameters?: Partial<UseQuestionCreationParameters>
		} = {},
	) {
		const loadCreatedZoltarQuestion = mock(async (_questionId: string) => undefined)
		const setZoltarForkQuestionId = mock((_questionId: string) => undefined)
		await moduleMocks.mockModule('@zoltar/ui-zoltar-shared/features/universes/hooks/useZoltarOperations.js', () => ({
			useZoltarOperations: () => ({ loadCreatedZoltarQuestion, setZoltarForkQuestionId }),
		}))
		const { useMarketCreation }: { useMarketCreation: UseMarketCreation } = await import(`../../../../../statoblastShared/ts/features/markets/hooks/useMarketCreation.ts?case=${crypto.randomUUID()}`)
		let hookState: UseMarketCreationState | undefined
		const Harness = function MarketCreationHarness(props: HarnessProps) {
			hookState = useMarketCreation(
				{
					accountAddress: 'accountAddress' in props ? props.accountAddress : WALLET_ADDRESS,
					activeUniverseId: props.activeUniverseId ?? 7n,
					autoLoadInitialData: false,
					deploymentStatuses: [DEPLOYED_QUESTION_DATA],
					environmentRefreshKey: props.environmentRefreshKey ?? 0,
					onTransactionFinished: () => undefined,
					onTransactionPresented: () => undefined,
					onTransactionRequested: () => undefined,
					onTransactionSubmitted: () => undefined,
					refreshState: async () => undefined,
					...options.parameters,
				},
				options.createMarket === undefined ? undefined : { createMarket: options.createMarket },
			)
			options.onRender?.(hookState)
			return <div />
		}
		let rendered = await renderIntoDocument(<Harness {...options.initialProps} />)
		trackCleanup(rendered.cleanup)
		const state = () => requireHookState(hookState)
		return {
			loadCreatedZoltarQuestion,
			setZoltarForkQuestionId,
			state,
			/** Renders new props without an `act` boundary so callers can combine it with other updates. */
			renderProps: (props: HarnessProps) => render(<Harness {...props} />, rendered.container),
			rerender: async (props: HarnessProps) => {
				await act(async () => {
					render(<Harness {...props} />, rendered.container)
				})
			},
			remount: async (props: HarnessProps) => {
				await rendered.cleanup()
				trackCleanup(undefined)
				hookState = undefined
				rendered = await renderIntoDocument(<Harness {...props} />)
				trackCleanup(rendered.cleanup)
			},
			setForm: async (update: Partial<MarketFormState>) => {
				await act(async () => {
					state().setMarketForm(current => ({ ...current, ...update }))
				})
			},
		}
	}

	test('blocks repeated market creation submissions while the first request is still preparing', async () => {
		const pendingCreate = createDeferred<CreatedMarket>()
		const createMarketTransaction = mock<CreateMarket>(async (_accountAddress, callbacks) => {
			callbacks.onTransactionSubmitted?.('0xabc')
			return await pendingCreate.promise
		})
		const hook = await renderMarketCreationHook({ createMarket: createMarketTransaction, initialProps: { activeUniverseId: 0n } })
		await hook.setForm({ endTime: '2026-07-02T00:00:00.000Z', title: 'Will this resolve?' })

		let firstCreate: Promise<unknown> | undefined
		let secondCreate: Promise<unknown> | undefined
		await act(() => {
			firstCreate = hook.state().createMarket({ refreshQuestionList: false })
			secondCreate = hook.state().createMarket({ refreshQuestionList: false })
		})
		if (firstCreate === undefined || secondCreate === undefined) {
			throw new Error('Expected both createMarket promises')
		}

		await waitFor(() => {
			expect(createMarketTransaction).toHaveBeenCalledTimes(1)
		})
		expect(hook.state().marketFeedback?.status.tone).toBe('pending')

		pendingCreate.resolve(CREATED_MARKET)

		await firstCreate
		await secondCreate

		expect(hook.loadCreatedZoltarQuestion).not.toHaveBeenCalled()
		expect(hook.setZoltarForkQuestionId).toHaveBeenCalledWith('0x0b')
	})

	test('clears the submission-in-progress latch after a pre-request wallet disconnect', async () => {
		const createMarketTransaction = mock(async () => CREATED_MARKET)
		const onTransactionRequested = mock(() => undefined)
		const hook = await renderMarketCreationHook({ createMarket: createMarketTransaction, initialProps: { activeUniverseId: 0n }, parameters: { onTransactionRequested } })
		await hook.setForm({ endTime: '2026-07-02T00:00:00.000Z', title: 'Will this resolve?' })

		replaceEnvironment(createFakeBackend())

		await act(async () => {
			await hook.state().createMarket()
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(createMarketTransaction).not.toHaveBeenCalled()
		expect(hook.state().marketFeedback?.status.tone).toBe('error')
		expect(hook.state().marketFeedback?.status.detail).toContain('Wallet account is no longer connected')
		expect(hook.state().marketError).toContain('Wallet account is no longer connected')

		replaceEnvironment(createFakeBackend({ accountAddress: WALLET_ADDRESS }))

		await act(async () => {
			await hook.state().createMarket()
		})

		expect(onTransactionRequested).toHaveBeenCalledTimes(1)
		expect(createMarketTransaction).toHaveBeenCalledTimes(1)
		expect(hook.loadCreatedZoltarQuestion).toHaveBeenCalledTimes(1)
		expect(hook.state().marketFeedback?.status.tone).toBe('success')
	})

	test('createMarket snapshots the submitted form before wallet preflight resolves', async () => {
		const activeAccounts = createDeferred<readonly Address[]>()
		const createMarketTransaction = mock(async (_accountAddress: Address, _callbacks: unknown, parameters: { questionData: { title: string } }) => ({
			...CREATED_MARKET,
			questionId: parameters.questionData.title === 'Question A' ? '0x0b' : '0x0c',
		}))
		replaceEnvironment({
			...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
			getAccounts: async () => await activeAccounts.promise,
		})
		const hook = await renderMarketCreationHook({ createMarket: createMarketTransaction, initialProps: { activeUniverseId: 0n } })
		await hook.setForm({ endTime: '2026-07-02T00:00:00.000Z', title: 'Question A' })

		let createPromise: Promise<unknown> = Promise.resolve()
		await act(() => {
			createPromise = hook.state().createMarket()
		})

		await hook.setForm({ title: 'Question B' })

		await act(async () => {
			activeAccounts.resolve([WALLET_ADDRESS])
			await createPromise
		})

		expect(createMarketTransaction).toHaveBeenCalledTimes(1)
		expect(createMarketTransaction.mock.calls[0]?.[2].questionData.title).toBe('Question A')
		expect(hook.loadCreatedZoltarQuestion).toHaveBeenCalledTimes(1)
		expect(hook.setZoltarForkQuestionId).toHaveBeenCalledWith('0x0b')
	})

	test('shows a rendered error source when global transaction admission rejects creation', async () => {
		const createMarketTransaction = mock(async () => CREATED_MARKET)
		const onTransactionFinished = mock(() => undefined)
		const hook = await renderMarketCreationHook({ createMarket: createMarketTransaction, initialProps: { activeUniverseId: 0n }, parameters: { onTransactionFinished, onTransactionRequested: () => false } })

		await act(async () => await hook.state().createMarket())

		expect(createMarketTransaction).not.toHaveBeenCalled()
		expect(onTransactionFinished).not.toHaveBeenCalled()
		expect(hook.state().marketError).toBeUndefined()
	})

	test('preserves an anonymous question draft when a wallet connects', async () => {
		const hook = await renderMarketCreationHook({
			createMarket: async () => {
				throw new Error('Question creation is not expected in this test')
			},
			initialProps: { accountAddress: undefined },
		})
		await act(async () => {
			hook.state().setMarketForm(current => ({ ...current, title: 'Anonymous draft' }))
			hook.renderProps({ accountAddress: WALLET_ADDRESS })
		})
		await waitFor(() => {
			expect(hook.state().marketForm.title).toBe('Anonymous draft')
		})

		await hook.remount({ accountAddress: WALLET_ADDRESS })
		expect(hook.state().marketForm.title).toBe('Anonymous draft')
	})

	test('keeps the anonymous draft when the connected account already has a draft', async () => {
		const hook = await renderMarketCreationHook({ initialProps: { accountAddress: undefined } })
		await hook.setForm({ title: 'Anonymous draft' })
		window.sessionStorage.setItem(OWNER_DRAFT_KEY, JSON.stringify({ ...hook.state().marketForm, title: 'Existing owner draft' }))

		await hook.rerender({ accountAddress: WALLET_ADDRESS })
		await waitFor(() => {
			expect(hook.state().marketForm.title).toBe('Existing owner draft')
		})
		expect(window.sessionStorage.getItem(OWNER_DRAFT_KEY)).toContain('Existing owner draft')
		expect(window.sessionStorage.getItem(ANONYMOUS_DRAFT_KEY)).toContain('Anonymous draft')
	})

	test('keeps the anonymous draft when copying it to connected storage fails', async () => {
		const storedValues = new Map<string, string>()
		const storageWithFailedOwnerWrites: Storage = {
			get length() {
				return storedValues.size
			},
			clear: () => storedValues.clear(),
			getItem: key => storedValues.get(key) ?? null,
			key: index => Array.from(storedValues.keys())[index] ?? null,
			removeItem: key => storedValues.delete(key),
			setItem: (key, value) => {
				if (key === OWNER_DRAFT_KEY) throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
				storedValues.set(key, value)
			},
		}
		await withSessionStorage(
			() => storageWithFailedOwnerWrites,
			async () => {
				const hook = await renderMarketCreationHook({ initialProps: { accountAddress: undefined } })
				await act(async () => {
					hook.state().setMarketForm(current => ({ ...current, title: 'Anonymous draft' }))
					hook.renderProps({ accountAddress: WALLET_ADDRESS })
				})
				await waitFor(() => {
					expect(hook.state().marketForm.title).toBe('Anonymous draft')
				})
				expect(storageWithFailedOwnerWrites.getItem(OWNER_DRAFT_KEY)).toBeNull()
				expect(storageWithFailedOwnerWrites.getItem(ANONYMOUS_DRAFT_KEY)).toContain('Anonymous draft')
			},
		)
	})

	test('keeps complete question drafts scoped by account and universe and clears a successful draft', async () => {
		const createMarketTransaction = mock(async (_accountAddress: Address, _callbacks: unknown, _parameters: { questionData: { title: string }; marketType: string; outcomeLabels: string[] }) => ({ ...CREATED_MARKET, marketType: 'scalar' as const }))
		let observedFormTitles: string[] = []
		const firstOwner = { accountAddress: WALLET_ADDRESS, activeUniverseId: 7n }
		const secondOwner = { accountAddress: SECOND_WALLET_ADDRESS, activeUniverseId: 9n }
		const hook = await renderMarketCreationHook({
			createMarket: createMarketTransaction,
			initialProps: firstOwner,
			onRender: state => {
				observedFormTitles.push(state.marketForm.title)
			},
		})

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
		await hook.setForm(scalarDraft)

		observedFormTitles = []
		await hook.rerender(secondOwner)
		expect(observedFormTitles.every(title => title === '')).toBe(true)
		await hook.setForm(categoricalDraft)

		await hook.rerender(firstOwner)
		await waitFor(() => {
			expect(hook.state().marketForm).toEqual({ ...scalarDraft, marketType: 'binary' })
		})

		observedFormTitles = []
		await hook.rerender(secondOwner)
		expect(observedFormTitles.every(title => title === categoricalDraft.title)).toBe(true)
		replaceEnvironment(createFakeBackend({ accountAddress: SECOND_WALLET_ADDRESS }))
		await act(async () => {
			await hook.state().createMarket()
		})
		expect(createMarketTransaction.mock.calls[0]?.[2].questionData.title).toBe(categoricalDraft.title)
		expect(createMarketTransaction.mock.calls[0]?.[2].marketType).toBe('binary')
		expect(createMarketTransaction.mock.calls[0]?.[2].outcomeLabels).toEqual(['Yes', 'No'])

		replaceEnvironment(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
		await hook.rerender(firstOwner)
		expect(hook.state().marketResult).toBeUndefined()
		expect(hook.state().marketFeedback).toBeUndefined()

		await act(async () => {
			await hook.state().createMarket()
		})

		await hook.remount(firstOwner)
		expect(hook.state().marketForm.title).toBe('')

		await hook.rerender(secondOwner)
		await waitFor(() => {
			expect(hook.state().marketForm.title).toBe('')
		})
	})

	test('keeps another universe draft visible when an in-flight question succeeds in the original universe', async () => {
		const pendingCreate = createDeferred<CreatedMarket>()
		const hook = await renderMarketCreationHook({ createMarket: async () => await pendingCreate.promise })
		await hook.setForm({ endTime: '2026-10-02T00:00:00.000Z', title: 'Universe A question' })

		let createPromise: Promise<unknown> | undefined
		await act(() => {
			createPromise = hook.state().createMarket()
		})
		await act(async () => {
			hook.renderProps({ activeUniverseId: 9n })
			hook.state().setMarketForm(current => ({ ...current, title: 'Unsent universe B draft' }))
		})
		expect(hook.state().marketCreating).toBe(false)
		await hook.rerender({ activeUniverseId: 7n })
		expect(hook.state().marketCreating).toBe(true)
		await hook.rerender({ activeUniverseId: 9n })

		pendingCreate.resolve(CREATED_MARKET)
		await act(async () => {
			await createPromise
		})

		expect(hook.state().marketForm.title).toBe('Unsent universe B draft')
		expect(hook.state().marketResult).toBeUndefined()
		expect(hook.state().marketFeedback).toBeUndefined()

		await hook.rerender({ activeUniverseId: 7n })
		expect(hook.state().marketResult?.questionId).toBe('0x0b')
		await hook.rerender({ activeUniverseId: 9n })
		expect(hook.state().marketForm.title).toBe('Unsent universe B draft')
	})

	test('ignores corrupt or unavailable question draft storage without blocking form use', async () => {
		window.sessionStorage.setItem(OWNER_DRAFT_KEY, '{invalid')
		const hook = await renderMarketCreationHook()
		expect(hook.state().marketForm.title).toBe('')
		await act(async () => {
			hook.state().setMarketForm(current => ({ ...current, title: 'Draft to reset' }))
			hook.state().resetMarket()
		})
		expect(window.sessionStorage.getItem(OWNER_DRAFT_KEY)).toBeNull()
		await hook.remount({})
		expect(hook.state().marketForm.title).toBe('')

		await withSessionStorage(
			() => {
				throw new DOMException('Storage unavailable', 'SecurityError')
			},
			async () => {
				await hook.setForm({ title: 'Usable without storage' })
				expect(hook.state().marketForm.title).toBe('Usable without storage')
			},
		)

		const unavailableStorage: Storage = {
			length: 0,
			clear: () => undefined,
			getItem: () => {
				throw new DOMException('Storage unavailable', 'SecurityError')
			},
			key: () => null,
			removeItem: () => undefined,
			setItem: () => undefined,
		}
		await withSessionStorage(
			() => unavailableStorage,
			async () => {
				await hook.rerender({ activeUniverseId: 8n })
				expect(hook.state().marketForm.title).toBe('')
			},
		)
	})

	test('returns no created question when the environment changes before completion', async () => {
		const deferred = createDeferred<CreatedMarket>()
		const hook = await renderMarketCreationHook({ createMarket: async () => await deferred.promise })
		await hook.setForm({ endTime: '2026-07-02T00:00:00.000Z', title: 'Environment zero question' })

		let submission = Promise.resolve<MarketCreationResult | undefined>(undefined)
		await act(async () => {
			submission = hook.state().createMarket()
			await Promise.resolve()
			await Promise.resolve()
		})
		await hook.rerender({ environmentRefreshKey: 1 })
		await act(async () => {
			deferred.resolve(CREATED_MARKET)
		})

		expect(await submission).toBeUndefined()
	})

	test('ignores deferred market completion callbacks from a replaced environment', async () => {
		const deferred = createDeferred<CreatedMarket>()
		let submittedCallbacks: Parameters<CreateMarket>[1] | undefined
		const onTransactionFinished = mock(() => undefined)
		const onTransactionPrepared = mock(() => undefined)
		const onTransactionPresented = mock(() => undefined)
		const onTransactionSubmitted = mock(() => undefined)
		const refreshState = mock(async () => undefined)
		const hook = await renderMarketCreationHook({
			createMarket: async (_accountAddress, callbacks) => {
				submittedCallbacks = callbacks
				return await deferred.promise
			},
			parameters: { onTransactionFinished, onTransactionPrepared, onTransactionPresented, onTransactionSubmitted, refreshState },
		})
		await hook.setForm({ endTime: '2026-07-02T00:00:00.000Z', title: 'Deferred question' })
		let submission: Promise<unknown> = Promise.resolve()
		await act(async () => {
			submission = hook.state().createMarket()
			await Promise.resolve()
			await Promise.resolve()
		})
		await hook.rerender({ environmentRefreshKey: 1 })
		submittedCallbacks?.onTransactionPrepared?.({ account: WALLET_ADDRESS, args: [], chainName: 'replacement test', functionName: 'createMarket', value: 0n })
		submittedCallbacks?.onTransactionSubmitted?.('0xabc')

		await act(async () => {
			deferred.resolve(CREATED_MARKET)
			await submission
		})
		expect(hook.state().marketResult).toBeUndefined()
		expect(hook.state().marketFeedback).toBeUndefined()
		expect(onTransactionPrepared).not.toHaveBeenCalled()
		expect(onTransactionSubmitted).not.toHaveBeenCalled()
		expect(onTransactionPresented).not.toHaveBeenCalled()
		expect(onTransactionFinished).toHaveBeenCalledTimes(1)
		expect(refreshState).not.toHaveBeenCalled()
		expect(hook.loadCreatedZoltarQuestion).not.toHaveBeenCalled()
		expect(hook.setZoltarForkQuestionId).not.toHaveBeenCalled()
	})
})

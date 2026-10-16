import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createPublicClient, getAddress, http, zeroAddress, toHex, decodeFunctionData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createMockLoaderClient, createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { getInfraContractAddresses, getSecurityPoolPortfolioRuntimeCode, getSecurityPoolPortfolioQuoteRuntimeCode, getSecurityPoolPortfolioVaultRuntimeCode, getSecurityPoolPortfolioVaultDeployerRuntimeCode } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { usePortfolioActions } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioActions.js'
import { usePortfolioAutomatic } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioAutomatic.js'
import { vaultArtifact, type PortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { usePortfolio } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolio.js'
import { portfolioStorageKey } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/preferences.js'
import { planPortfolioAllocations } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { renderHookWithProps } from '../../support/renderHook.js'

const deployer = getAddress('0x00000000000000000000000000000000000000d1')
const quoteHelper = getAddress('0x00000000000000000000000000000000000000e1')
const owner = getAddress('0x0000000000000000000000000000000000000011')
const manager = getAddress('0x0000000000000000000000000000000000000022')
const lifecycle = installDomTestLifecycle({ url: `https://example.test/#/portfolios?portfolio=${manager}&owner=${owner}`, afterTest: resetActiveEnvironmentForTesting })

async function renderDeferredPortfolio() {
	const firstChainId = createDeferred<number>()
	let reads = 0
	const client = createPublicClient({ transport: http('https://example.test') }).extend(() => ({
		getChainId: async () => (++reads === 1 ? await firstChainId.promise : 1),
		getCode: async ({ address }: { address: Address }) => {
			if (address === quoteHelper) return getSecurityPoolPortfolioQuoteRuntimeCode()
			return address === deployer ? getSecurityPoolPortfolioVaultDeployerRuntimeCode() : getSecurityPoolPortfolioRuntimeCode()
		},
		...createMockReadClient(async request => {
			if (request.functionName === 'quoteHelper') return quoteHelper
			if (request.functionName === 'vaultDeployer') return deployer
			if (request.functionName === 'portfolio') return manager
			if (request.functionName === 'factory') return getInfraContractAddresses().securityPoolFactory
			if (request.functionName === 'vaultOf') return zeroAddress
			if (request.functionName === 'originUniverseId') return 0n
			throw new Error(`Unexpected portfolio read: ${request.functionName}`)
		}),
	}))
	installActiveEnvironmentForTesting({ ...createFakeBackend({ accountAddress: owner }), createReadClient: () => client })
	const hook = lifecycle.trackRendered(await renderHookWithProps(usePortfolio, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n }))
	await waitFor(() => expect(reads).toBe(1))
	return { hook, firstChainId }
}

test('replaces an invalidated refresh without leaving portfolio loading stranded', async () => {
	const { hook, firstChainId } = await renderDeferredPortfolio()
	expect(hook.state().loading).toBe(true)
	await hook.setProps({ environmentKey: 1 })
	await act(async () => {
		firstChainId.resolve(1)
		await firstChainId.promise
	})
	await waitFor(() => {
		expect(hook.state().loading).toBe(false)
		expect(hook.state().selection?.owner).toBe(owner)
	})
})

test('clears loading when disabled and starts a fresh load when reenabled', async () => {
	const { hook, firstChainId } = await renderDeferredPortfolio()
	await hook.setProps({ enabled: false })
	expect(hook.state().loading).toBe(false)
	await hook.setProps({ enabled: true })
	await waitFor(() => expect(hook.state().selection?.owner).toBe(owner))
	await act(async () => {
		firstChainId.resolve(1)
		await firstChainId.promise
	})
	expect(hook.state().loading).toBe(false)
	expect(hook.state().selection?.owner).toBe(owner)
})

test('loads route-derived owner changes without a separate load action', async () => {
	const { hook, firstChainId } = await renderDeferredPortfolio()
	firstChainId.resolve(1)
	await waitFor(() => expect(hook.state().selection?.owner).toBe(owner))
	const nextOwner = getAddress('0x0000000000000000000000000000000000000012')
	await act(() => {
		window.location.hash = `/portfolios?portfolio=${manager}&owner=${nextOwner}`
		window.dispatchEvent(new Event('hashchange'))
	})
	await waitFor(() => expect(hook.state().selection?.owner).toBe(nextOwner))
	expect(hook.state().loading).toBe(false)
})

function registryFixture(questionCount = 300n, options: { observationRead?: () => Promise<void>; pendingPerPool?: number; allocatedCount?: bigint; readPosition?: (questionId: bigint) => Promise<void> } = {}) {
	const vault = getAddress('0x0000000000000000000000000000000000000033')
	const hash = toHex(1n, { size: 32 })
	const queries: { functionName: string; args: readonly unknown[] }[] = []
	const poolAddress = (questionId: bigint) => getAddress(toHex(questionId + 1000n, { size: 20 }))
	const backing = new Map([
		[1n, 10n],
		[2n, 20n],
	])
	const client = createPublicClient({ transport: http('https://example.test') }).extend(() => ({
		getChainId: async () => 1,
		getCode: async ({ address }: { address: Address }) => {
			if (address === quoteHelper) return getSecurityPoolPortfolioQuoteRuntimeCode()
			if (address === deployer) return getSecurityPoolPortfolioVaultDeployerRuntimeCode()
			if (address === manager) return getSecurityPoolPortfolioRuntimeCode()
			return getSecurityPoolPortfolioVaultRuntimeCode()
		},
		...createMockLoaderClient({
			getBlock: async parameters => {
				if (parameters?.blockNumber === 12n) await options.observationRead?.()
				return { number: parameters?.blockNumber ?? 123n, hash, timestamp: 1000n }
			},
			multicall: async () => {
				throw new Error('Unexpected multicall')
			},
			readContract: async ({ address, functionName, args = [] }) => {
				queries.push({ functionName, args })
				switch (functionName) {
					case 'quoteHelper':
						return quoteHelper
					case 'vaultDeployer':
						return deployer
					case 'factory':
						return getInfraContractAddresses().securityPoolFactory
					case 'owner':
						return owner
					case 'portfolio':
						return manager
					case 'vaultOf':
					case 'predictVaultAddress':
						return vault
					case 'originUniverseId':
					case 'universeId':
					case 'getForkTime':
					case 'initialReportPriorityFeeAttoEthPerGas':
					case 'totalUnderwritingLimitAttoEth':
					case 'settlementCollateralAttoEth':
					case 'getVaultOpenInterestAttoEth':
					case 'vaultBadDebtAttoEth':
					case 'pendingReportId':
					case 'systemState':
						return 0n
					case 'getActiveStagedOperationCount':
						return BigInt(options.pendingPerPool ?? 0)
					case 'getActiveStagedOperations': {
						const [start, count] = args
						if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Invalid operation page')
						const ids = Array.from({ length: Number(count) }, (_, index) => start + BigInt(index) + 1n)
						return [ids, ids.map(() => [3n, vault, vault, owner, '0x', 900n, 300n])]
					}
					case 'allocatedQuestionCount':
						return options.allocatedCount ?? 0n
					case 'allocationPolicy':
						return [{ universeId: 0n, executor: zeroAddress, expiresAt: 0n, depositBudgetAttoRep: 0n, commitmentIncreaseBudgetAttoEth: 0n, minimumIdleAttoRep: 0n, minimumHealthFactorBps: 10000n }, owner, 0n, 0n]
					case 'getEthBalance':
						return 0n
					case 'allocationPolicyVersion':
					case 'allocationPolicyNonce':
					case 'withdrawalRequestId':
						return 1n
					case 'withdrawalResidualForfeitureAllowed':
						return false
					case 'withdrawalRequested':
						return true
					case 'maximumQuestionHorizonSeconds':
						return 86400n
					case 'withdrawalRequestCount':
						return 0n
					case 'getWithdrawalRequests':
						return []
					case 'questionCount':
						return questionCount
					case 'getAllocatedQuestions':
					case 'getQuestions': {
						const [start, count] = args
						if (typeof start !== 'bigint' || typeof count !== 'bigint') throw new Error('Invalid question page')
						if (functionName === 'getQuestions' && questionCount === 0n) return []
						return Array.from({ length: Number(count) }, (_, index) => start + BigInt(index) + 1n)
					}
					case 'questionOriginIds':
					case 'getPortfolioOriginId': {
						const id = args[functionName === 'questionOriginIds' ? 0 : 2]
						if (typeof id !== 'bigint') throw new Error('Missing question ID')
						return toHex(id, { size: 32 })
					}
					case 'getSecurityPool': {
						if (typeof args[0] !== 'string') throw new Error('Missing origin ID')
						return poolAddress(BigInt(args[0]))
					}
					case 'questionId':
						await options.readPosition?.(BigInt(address) - 1000n)
						return BigInt(address) - 1000n
					case 'zoltar':
					case 'questionData':
					case 'repToken':
					case 'priceFeed':
					case 'getRepToken':
						return owner
					case 'openOraclePriceCoordinator':
						return options.pendingPerPool === undefined ? owner : getAddress(toHex(BigInt(address) + 5000n, { size: 20 }))
					case 'escalationGame':
						return zeroAddress
					case 'securityVaults':
						return [backing.get(BigInt(address) - 1000n) ?? 0n, 0n, 0n, 0n]
					case 'getTotalPoolHeldAttoRep':
					case 'totalRepBackingUnits':
						return 100n
					case 'balanceOf':
						return 1000n
					case 'statoblastSecurityMultiplierBps':
						return 20_000n
					case 'minimumVaultRepDepositAttoRep':
						return 1n
					case 'isEscalationResolved':
						return false
					case 'getQuestionEndDate':
						return 2000n
					case 'lastPrice':
						return 10n ** 18n
					case 'isPriceValid':
						return true
					case 'settlementTime':
						return 60n
					default:
						throw new Error(`Unexpected portfolio read: ${functionName}`)
				}
			},
		}),
	}))
	installActiveEnvironmentForTesting({ ...createFakeBackend({ accountAddress: owner }), createReadClient: () => client })
	return { queries, backing, vault, hash, preferencesKey: portfolioStorageKey({ backend: 'injected', chainId: '1', portfolio: manager, owner }, 'preferences'), historyKey: portfolioStorageKey({ backend: 'injected', chainId: '1', portfolio: manager, owner }, 'operations') }
}

test('permissionless registry growth cannot block saved owner selections and known positions', async () => {
	const { queries, preferencesKey } = registryFixture()
	window.localStorage.setItem(preferencesKey, JSON.stringify({ watchedQuestionIds: [], universeIds: [], selectedQuestionIds: ['1'], knownPositionQuestionIds: ['2'] }))
	const hook = lifecycle.trackRendered(await renderHookWithProps(usePortfolio, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n }))
	await waitFor(() => expect(hook.state().loading).toBe(false))
	expect(hook.state().error).toBeUndefined()
	expect(hook.state().snapshot?.coverage.complete).toBe(true)
	expect(hook.state().snapshot?.coverage.registryComplete).toBe(false)
	expect(hook.state().snapshot?.questions).toEqual([1n, 2n])
	expect(queries.filter(query => query.functionName === 'getQuestions')).toEqual([])
	await act(async () => {
		await hook.state().refresh()
	})
	expect(hook.state().snapshot?.questions).toEqual([1n, 2n])
	expect(queries.filter(query => query.functionName === 'getQuestions')).toEqual([])
})

test('a new portfolio remains available before its first question is registered', async () => {
	registryFixture(0n)
	const hook = lifecycle.trackRendered(await renderHookWithProps(usePortfolio, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n }))
	await waitFor(() => expect(hook.state().loading).toBe(false))
	expect(hook.state().selection?.portfolio).toBe(manager)
	expect(hook.state().snapshot).toBeUndefined()
	expect(hook.state().error).toBeUndefined()
})

test('bootstraps only the fixed initial question and never expands it on later refreshes', async () => {
	const { queries, preferencesKey } = registryFixture()
	const hook = lifecycle.trackRendered(await renderHookWithProps(usePortfolio, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n }))
	await waitFor(() => expect(hook.state().loading).toBe(false))
	expect(hook.state().error).toBeUndefined()
	expect(hook.state().snapshot?.questions).toEqual([1n])
	expect(hook.state().snapshot?.coverage).toMatchObject({ complete: true, registryComplete: false })
	expect(queries.filter(query => query.functionName === 'getQuestions')).toEqual([{ functionName: 'getQuestions', args: [0n, 1n] }])
	expect(JSON.parse(window.localStorage.getItem(preferencesKey) ?? '{}')).toMatchObject({ selectedQuestionIds: ['1'], knownPositionQuestionIds: ['1'] })
	await act(async () => {
		await hook.state().refresh()
	})
	expect(queries.filter(query => query.functionName === 'getQuestions')).toHaveLength(1)
	expect(hook.state().questionFilter).toBe('1')
})

test('automatically loads explicit questions and retains known funded positions when selection or watchlists change', async () => {
	const { queries, preferencesKey } = registryFixture()
	const hook = lifecycle.trackRendered(await renderHookWithProps(usePortfolio, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n }))
	await waitFor(() => expect(hook.state().loading).toBe(false))
	await act(() => {
		hook.state().setQuestionFilter('0x2, 3')
	})
	await waitFor(() => expect(hook.state().snapshot?.questions).toEqual([2n, 3n, 1n]))
	await act(() => {
		hook.state().toggleWatch(2n)
		hook.state().toggleWatch(2n)
		hook.state().setQuestionFilter('4')
	})
	await act(async () => {
		await hook.state().load()
	})
	expect(hook.state().snapshot?.questions).toEqual([4n, 1n, 2n])
	expect(hook.state().snapshot?.coverage.complete).toBe(true)
	expect(JSON.parse(window.localStorage.getItem(preferencesKey) ?? '{}')).toEqual({ watchedQuestionIds: [], universeIds: [], selectedQuestionIds: ['4'], knownPositionQuestionIds: ['1', '2'] })
	await act(() => {
		hook.state().setQuestionFilter('')
	})
	await act(async () => {
		await hook.state().refresh()
	})
	expect(hook.state().snapshot?.questions).toEqual([4n, 1n, 2n])
	expect(queries.filter(query => query.functionName === 'getQuestions')).toHaveLength(1)
})

test('refreshes more than 256 discovered positions and prepares withdrawal from a later page', async () => {
	const nextPageRead = createDeferred<void>()
	const { queries, preferencesKey, backing } = registryFixture(500n, {
		allocatedCount: 300n,
		readPosition: async id => {
			if (id === 65n) await nextPageRead.promise
		},
	})
	for (let id = 1n; id <= 300n; id++) backing.set(id, 10n)
	backing.set(400n, 10n)
	window.localStorage.setItem(preferencesKey, JSON.stringify({ watchedQuestionIds: [], universeIds: [], selectedQuestionIds: ['400'], knownPositionQuestionIds: [] }))
	let captured: PortfolioTransaction | undefined
	const hook = lifecycle.trackRendered(
		await renderHookWithProps(
			(parameters: Parameters<typeof usePortfolio>[0]) => {
				const model = usePortfolio(parameters)
				const actions = usePortfolioActions(model, { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }, 0n)
				const automatic = usePortfolioAutomatic(
					model,
					{
						vaultReason: undefined,
						runPortfolioAction: async (_action, _label, build) => {
							captured = await build()
						},
					},
					owner,
				)
				return { model, automatic, actions }
			},
			{ accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n },
		),
	)
	await waitFor(() => expect(hook.state().model.loading).toBe(false))
	await act(async () => {
		await hook.state().model.refresh()
	})
	expect(hook.state().model.error).toBeUndefined()
	await waitFor(() => expect(hook.state().automatic.cancelReason).toBeUndefined())
	const nextPage = hook.state().model.nextPositionPage()
	await waitFor(() => expect(hook.state().model.loading).toBe(true))
	expect(hook.state().model.snapshot).toBeDefined()
	expect(hook.state().automatic.cancelReason).toBeUndefined()
	expect(hook.state().automatic.positions.every(position => position.processReason === 'Loading portfolio…')).toBe(true)
	await act(async () => {
		nextPageRead.resolve()
		await nextPage
	})
	for (let page = 2; page < 5; page++) {
		await act(async () => {
			await hook.state().model.nextPositionPage()
		})
		expect(hook.state().model.snapshot?.questions.length).toBeLessThanOrEqual(128)
	}
	expect(hook.state().model.preferences.knownPositionQuestionIds.length).toBeGreaterThan(256)
	await act(async () => {
		await hook.state().model.refresh()
	})
	expect(hook.state().model.error).toBeUndefined()
	expect(hook.state().model.positionPage).toBe(4n)
	expect(hook.state().model.snapshot?.coverage.complete).toBe(false)
	expect(hook.state().model.snapshot?.questions).toContain(300n)
	await waitFor(() => expect(hook.state().automatic.cancelReason).toBeUndefined())
	const position = hook.state().automatic.positions.find(item => item.questionId === 300n)
	if (position === undefined) throw new Error('Expected the later allocated position')
	expect(position.processReason).toBeUndefined()
	await act(async () => {
		await position.process()
	})
	if (captured === undefined) throw new Error('Expected a prepared withdrawal')
	expect(decodeFunctionData({ abi: vaultArtifact.abi, data: captured.data })).toMatchObject({ functionName: 'processWithdrawal', args: [300n, 0n] })
	await captured.validateBeforeSubmit?.()
	const allocationReads = queries.filter(query => query.functionName === 'getAllocatedQuestions').length
	await act(() => hook.state().actions.setDraft(300n, { selected: true, deposit: '0.000000000000000001', commitment: '0' }))
	await act(async () => {
		await hook.state().actions.exportBatch()
	})
	expect(hook.state().actions.error).toBeUndefined()
	expect(hook.state().actions.exported).toBeDefined()
	expect(queries.filter(query => query.functionName === 'getAllocatedQuestions')).toHaveLength(allocationReads)
	await act(() => hook.state().model.setQuestionFilter('300'))
	await act(async () => {
		await hook.state().model.load()
	})
	expect(hook.state().model.positionPage).toBe(0n)
	expect(hook.state().model.snapshot?.questions).toContain(300n)
	expect(hook.state().model.error).toBeUndefined()
	expect(queries.filter(query => query.functionName === 'getQuestions')).toEqual([])
	expect(queries.filter(query => query.functionName === 'getAllocatedQuestions').every(query => typeof query.args[1] === 'bigint' && query.args[1] <= 64n)).toBe(true)
})

test('paginates remembered positions without scanning the permissionless registry', async () => {
	const { queries, preferencesKey } = registryFixture(100_000n)
	window.localStorage.setItem(preferencesKey, JSON.stringify({ watchedQuestionIds: [], universeIds: [], selectedQuestionIds: ['1'], knownPositionQuestionIds: Array.from({ length: 300 }, (_, index) => String(index + 1)) }))
	const hook = lifecycle.trackRendered(await renderHookWithProps(usePortfolio, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n }))
	await waitFor(() => expect(hook.state().loading).toBe(false))
	expect(hook.state().error).toBeUndefined()
	expect(hook.state().snapshot?.questions).toHaveLength(64)
	expect(hook.state().snapshot?.coverage.complete).toBe(false)
	await act(async () => {
		await hook.state().nextPositionPage()
	})
	expect(hook.state().snapshot?.questions).toEqual(Array.from({ length: 64 }, (_, index) => BigInt(index + 65)))
	expect(queries.filter(query => query.functionName === 'getQuestions')).toEqual([])
})

test('storage quota failures preserve verified balances and the usable planning snapshot', async () => {
	const { preferencesKey } = registryFixture()
	window.localStorage.setItem(preferencesKey, JSON.stringify({ watchedQuestionIds: [], universeIds: [], selectedQuestionIds: ['1'], knownPositionQuestionIds: ['2'] }))
	const storage = window.localStorage
	const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => storage.getItem(key),
			setItem: () => {
				throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
			},
		},
	})
	try {
		const hook = lifecycle.trackRendered(await renderHookWithProps(usePortfolio, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n }))
		await waitFor(() => expect(hook.state().loading).toBe(false))
		expect(hook.state().error).toBeUndefined()
		expect(hook.state().snapshot?.coverage.complete).toBe(true)
		expect(hook.state().snapshot?.questions).toEqual([1n, 2n])
		expect(hook.state().snapshot?.branches[0]?.idleAttoRep).toBe(1000n)
		const snapshot = hook.state().snapshot
		if (snapshot === undefined) throw new Error('Expected a usable verified snapshot')
		expect(planPortfolioAllocations({ snapshot, universeId: 0n, minimumIdleAttoRep: 0n, minimumHealthFactorBps: 10_000n, allocations: [{ questionId: 1n, depositAttoRep: 1n, commitmentAttoEth: 0n }] }).operations).toHaveLength(1)
		expect(hook.state().historyWarning).toContain('storage is unavailable')
		await act(() => hook.state().setQuestionFilter('3'))
		await act(async () => {
			await hook.state().load()
		})
		expect(hook.state().snapshot?.questions).toEqual([3n, 2n, 1n])
	} finally {
		if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
		else Reflect.deleteProperty(window, 'localStorage')
	}
})

test('stalled history enrichment cannot delay balance refreshes or spawn overlapping history requests', async () => {
	const blocked = createDeferred<void>()
	let observationReads = 0
	const { preferencesKey, historyKey, vault, hash, backing } = registryFixture(300n, {
		observationRead: async () => {
			observationReads++
			await blocked.promise
		},
	})
	window.localStorage.setItem(preferencesKey, JSON.stringify({ watchedQuestionIds: [], universeIds: [], selectedQuestionIds: ['1'], knownPositionQuestionIds: [] }))
	window.localStorage.setItem(
		historyKey,
		JSON.stringify([
			{ coordinator: owner, pool: getAddress(toHex(1001n, { size: 20 })), operationId: '1', operation: '0', fromBlock: '12', universeId: '0', questionId: '1', observation: { blockNumber: '12', blockHash: hash, vault, operator: owner, receiverVault: owner, targetVault: vault, queuedAt: '900', validForSeconds: '300' } },
		]),
	)
	const hook = lifecycle.trackRendered(await renderHookWithProps(usePortfolio, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n }))
	await waitFor(() => {
		expect(hook.state().loading).toBe(false)
		expect(hook.state().snapshot?.branches[0]?.positions[0]?.backingAttoRep).toBe(10n)
		expect(observationReads).toBe(1)
	})
	backing.set(1n, 42n)
	await act(async () => {
		await hook.state().refresh()
	})
	expect(hook.state().snapshot?.branches[0]?.positions[0]?.backingAttoRep).toBe(42n)
	expect(observationReads).toBe(1)
	await act(async () => {
		blocked.resolve()
		await blocked.promise
	})
	expect(hook.state().snapshot?.branches[0]?.positions[0]?.backingAttoRep).toBe(42n)
})

test('retains all live authorized pending operations while capping the persisted history cache', async () => {
	const { preferencesKey, historyKey } = registryFixture(300n, { pendingPerPool: 200 })
	window.localStorage.setItem(preferencesKey, JSON.stringify({ watchedQuestionIds: [], universeIds: [], selectedQuestionIds: ['1', '2', '3'], knownPositionQuestionIds: [] }))
	const hook = lifecycle.trackRendered(await renderHookWithProps(usePortfolio, { accountAddress: owner, enabled: true, environmentKey: 0, activeUniverseId: 0n }))
	await waitFor(() => {
		expect(hook.state().loading).toBe(false)
		expect(hook.state().history).toHaveLength(600)
	})
	expect(hook.state().error).toBeUndefined()
	expect(hook.state().snapshot?.branches[0]?.positions.every(position => position.queuedOperations.length === 200)).toBe(true)
	expect(hook.state().history.every(entry => entry.result.status === 'pending')).toBe(true)
	expect(JSON.parse(window.localStorage.getItem(historyKey) ?? '[]')).toHaveLength(256)
	expect(hook.state().preferences.knownPositionQuestionIds).toEqual(['1', '2', '3'])
})

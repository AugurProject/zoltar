import type { WriteClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { asWriteClient, createMockWriteClient, mockTransactionHash } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { localEntityScopeForNetwork, readFavoriteEntries } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { useSecurityPoolActions } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolActions.js'
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiItem, parseAbiParameters, toEventSelector, TransactionLookupNotFoundError, type Address, type Hash, type Hex, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { getInfraContractAddresses } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { auctionCapitalSnapshot, capitalSnapshot, owner, securityPool, token, capital } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
import { getZoltarContractAddresses } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { auctionFixture } from './auctionFixture.js'
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const parameters = { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }
function model(): Parameters<typeof useSecurityPoolActions>[0] {
	return {
		managerInput: securityPool,
		ownerInput: owner,
		universeInput: '0',
		snapshot: capitalSnapshot(),
		presentationSnapshot: undefined,
		displayedAt: undefined,
		setup: undefined,
		savedSetupStage: undefined,
		loading: false,
		error: undefined,
		setManagerInput: () => undefined,
		setOwnerInput: () => undefined,
		setUniverseInput: () => undefined,
		load: async () => undefined,
		refresh: async () => undefined,
		previousQuestionPage: async () => undefined,
		nextQuestionPage: async () => undefined,
		previousApprovedQuestionPage: async () => undefined,
		nextApprovedQuestionPage: async () => undefined,
	}
}
const replacementHash: Hash = `0x${'2'.repeat(64)}`
const factory = () => getInfraContractAddresses().securityPoolFactory
const deploymentTopic = (value: Address) => encodeAbiParameters(parseAbiParameters('address'), [value])
const deployedPoolLog = () => ({ address: factory(), data: '0x' as const, topics: [toEventSelector(parseAbiItem('event SecurityPoolDeployed(address indexed securityPool, address indexed creator)')), deploymentTopic(securityPool), deploymentTopic(owner)] })

/** Renders the actions over `source` with an owner wallet that records each transaction, reports `token` as the first deployed contract and the factory's deployment event for `securityPool` after it. */
async function renderWithDeploymentWallet(source: ReturnType<typeof capitalClient>, deploying = false, delays: { wallet?: Promise<void>; receipt?: Promise<void>; confirmed?: () => boolean; unrelatedReplacement?: () => void } = {}) {
	// The factory creates the security pool, so the receipt carries no contract address for it: only the factory's event names it.
	const requests: { to?: Address | null | undefined; data?: Hex | undefined }[] = []
	const receiptHashes: Hash[] = []
	const loaded: string[] = []
	const receipt = () => (requests.length === 1 ? { from: owner, to: undefined, status: 'success' as const, contractAddress: token, logs: [] } : { from: owner, to: factory(), status: 'success' as const, contractAddress: undefined, logs: [deployedPoolLog()] })
	const writer = asWriteClient({
		...createMockWriteClient(request => requests.push(request)),
		waitForTransactionReceipt: async ({ onReplaced }: Parameters<WriteClient['waitForTransactionReceipt']>[0]) => {
			if (delays.unrelatedReplacement !== undefined) {
				onReplaced?.({ reason: 'replaced', transaction: { hash: replacementHash }, replacedTransaction: { hash: mockTransactionHash }, transactionReceipt: { ...receipt(), transactionHash: replacementHash, blockHash: mockTransactionHash, blockNumber: 1n, cumulativeGasUsed: 1n, gasUsed: 1n, transactionIndex: 0n } })
				delays.unrelatedReplacement()
			}
			if (requests.length !== 1 || delays.wallet === undefined) await delays.receipt
			return receipt()
		},
	})
	installActiveEnvironmentForTesting({
		...source.backend,
		createReadClient: () =>
			source.client.extend(() => ({
				getTransactionReceipt: async ({ hash }) => {
					receiptHashes.push(hash)
					if (delays.confirmed?.() !== true) throw new TransactionLookupNotFoundError('receipt', hash)
					return { ...receipt(), transactionHash: mockTransactionHash, blockHash: mockTransactionHash, blockNumber: 1n, cumulativeGasUsed: 1n, gasUsed: 1n, transactionIndex: 0n } satisfies TransactionReceipt
				},
			})),
		createWriteClient: (_, callbacks) => ({
			...writer,
			account: { address: owner, type: 'json-rpc' },
			chain: MAINNET_NETWORK_PROFILE.chain,
			call: async () => ({ data: undefined }),
			onTransactionSubmitted: callbacks?.onTransactionSubmitted,
			sendTransaction: async request => {
				callbacks?.assertBeforeSubmit?.()
				const hash = await writer.sendTransaction(request)
				if (requests.length === 1) await delays.wallet
				callbacks?.onTransactionSubmitted?.(hash)
				return hash
			},
		}),
	})
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, {
		deploying,
		model: {
			...model(),
			load: async address => {
				loaded.push(address ?? '')
			},
		},
	})
	lifecycle.trackRendered(hook)
	return { hook, requests, loaded, receiptHashes }
}
test('creation uses an explicit admission transaction before deployment and invalidates changed policies', async () => {
	const source = capitalClient()
	const { hook, requests, loaded } = await renderWithDeploymentWallet(source)
	await act(() => hook.state().setOriginInput(securityPool))
	expect(hook.state().deployReason).toContain('question rules first')
	await act(() => hook.state().deployAdmission())
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(1)
	expect(hook.state().admissionAddress).toBe(token)
	expect(hook.state().deployReason).toBeUndefined()
	await act(() => hook.state().deploy())
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(2)
	expect(requests[1]?.to).toBe(getInfraContractAddresses().securityPoolFactory)
	expect(loaded).toEqual([securityPool])
	await act(() => {
		hook.state().setAdmissionMode('fixed')
		hook.state().setFixedQuestions('5,7')
	})
	expect(hook.state().admissionAddress).toBeUndefined()
	expect(hook.state().deployReason).toContain('question rules first')
})
test('prepared question rules and locked deployment inputs survive remount for the same wallet', async () => {
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true)
	await act(() => {
		hook.state().setOriginInput('7')
		hook.state().setHorizonDays('40')
		hook.state().setEconomicsField('minimumCommitment', '2')
	})
	await act(() => hook.state().deployAdmission())
	expect(hook.state().error).toBeUndefined()
	await act(() => hook.cleanup())
	const resumed = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
	expect(resumed.state().admissionAddress).toBe(token)
	expect(resumed.state().originInput).toBe('7')
	expect(resumed.state().horizonDays).toBe('40')
	expect(resumed.state().economicsDraft.minimumCommitment).toBe('2')
	await act(() => resumed.state().setOriginInput('8'))
	expect(resumed.state().originInput).toBe('7')
	await act(() => resumed.state().deploy())
	expect(requests).toHaveLength(2)
	await act(() => resumed.cleanup())
	const restoredSetups: string[] = []
	const deployed = lifecycle.trackRendered(
		await renderHookWithProps(useSecurityPoolActionsWrapper, {
			model: {
				...model(),
				load: async (pool, wallet, universe) => {
					restoredSetups.push(`${pool}:${wallet}:${universe}`)
				},
			},
			deploying: true,
		}),
	)
	expect(restoredSetups).toEqual([`${securityPool}:${owner}:7`])
	expect(deployed.state().deployReason).toBeDefined()
	await act(() => deployed.state().deploy())
	expect(requests).toHaveLength(2)
	await deployed.setProps({ parameters: { ...parameters, accountAddress: token } })
	expect(deployed.state().admissionAddress).toBeUndefined()
	expect(deployed.state().originInput).toBe('0')
})

test('confirmed activation keeps the locked deployment available after remount', async () => {
	const { hook } = await renderWithDeploymentWallet(capitalClient(), true)
	await act(() => hook.state().deployAdmission())
	await act(() => hook.state().deploy())
	const snapshot = capitalSnapshot()
	const ready = {
		...model(),
		setup: { securityPool, owner, stage: 4, originUniverseId: 0n, originForkTime: 0n, chainId: 1, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash, timestamp: snapshot.timestamp },
	}
	await hook.setProps({ model: ready, deploying: true })
	await act(() => hook.cleanup())
	const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: ready, deploying: true }))
	expect(restored.state().deploymentLocked).toBe(true)
	expect(restored.state().admissionAddress).toBe(token)
})

test('the deployment wizard keeps a wallet-dispatched rules deployment locked on reload before the hash arrives', async () => {
	const wallet = createDeferred<void>()
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true, { wallet: wallet.promise })
	let sending: Promise<void> | undefined
	try {
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await waitFor(() => expect(requests).toHaveLength(1))
		await act(() => hook.cleanup())
		const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
		expect(restored.state().deploymentLocked).toBe(true)
		expect(restored.state().admissionDeployReason).toBeDefined()
		await act(() => restored.state().deployAdmission())
		expect(requests).toHaveLength(1)
	} finally {
		wallet.resolve()
		await sending
	}
})

test('an explicit wallet rejection unlocks the rules deployment again', async () => {
	const wallet = createDeferred<void>()
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true, { wallet: wallet.promise })
	let sending: Promise<void> | undefined
	await act(() => {
		sending = hook.state().deployAdmission()
	})
	await waitFor(() => expect(hook.state().deploymentLocked).toBe(true))
	await act(async () => {
		wallet.reject(Object.assign(new Error('User rejected request'), { code: 4001 }))
		await sending
	})
	expect(hook.state().deploymentLocked).toBe(false)
	expect(hook.state().admissionDeployReason).toBeUndefined()
	expect(requests).toHaveLength(1)
})

test('a different transaction replacing the rules send is never adopted on reload', async () => {
	const receipt = createDeferred<void>()
	const replaced = createDeferred<void>()
	const { hook, receiptHashes } = await renderWithDeploymentWallet(capitalClient(), true, { receipt: receipt.promise, confirmed: () => true, unrelatedReplacement: () => replaced.resolve() })
	let sending: Promise<void> | undefined
	try {
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await replaced.promise
		await act(() => hook.cleanup())
		const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
		expect(restored.state().admissionAddress).toBeUndefined()
		expect(restored.state().pendingDeployment).toBeUndefined()
		expect(receiptHashes).not.toContain(replacementHash)
	} finally {
		receipt.resolve()
		await sending
	}
})

for (const step of ['rules', 'pool'] as const) {
	test(`the deployment wizard verifies the pending ${step} receipt on reload before unlocking the next step`, async () => {
		const receipt = createDeferred<void>()
		let confirmed = false
		const { hook, requests, receiptHashes } = await renderWithDeploymentWallet(capitalClient(), true, { ...(step === 'pool' ? { wallet: Promise.resolve() } : {}), receipt: receipt.promise, confirmed: () => confirmed })
		let sending: Promise<void> | undefined
		try {
			if (step === 'pool') await act(() => hook.state().deployAdmission())
			await act(() => {
				sending = step === 'rules' ? hook.state().deployAdmission() : hook.state().deploy()
			})
			const transactionCount = step === 'rules' ? 1 : 2
			await waitFor(() => expect(requests).toHaveLength(transactionCount))
			await act(() => hook.cleanup())
			const waiting = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
			expect(waiting.state().deploymentLocked).toBe(true)
			expect(step === 'rules' ? waiting.state().admissionDeployReason : waiting.state().deployReason).toBeDefined()
			await act(() => waiting.cleanup())
			confirmed = true
			const load = mock(async (_pool?: string) => undefined)
			const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...model(), load }, deploying: true }))
			await waitFor(() => expect(step === 'rules' ? restored.state().admissionAddress : restored.state().deploymentPool).toBe(step === 'rules' ? token : securityPool))
			if (step === 'pool') {
				expect(restored.state().preparationReason(1)).toBe('Try again to verify the saved setup progress.')
				await act(() => restored.state().refreshDeploymentProgress())
				expect(load).toHaveBeenCalledTimes(2)
				expect(load.mock.calls[1]?.[0]).toBe(securityPool)
			}
			expect(new Set(receiptHashes)).toEqual(new Set([mockTransactionHash]))
			expect(requests).toHaveLength(transactionCount)
		} finally {
			receipt.resolve()
			await sending
		}
	})
}

test('starting a new deployment unlocks a discarded rules-only draft', async () => {
	const { hook } = await renderWithDeploymentWallet(capitalClient(), true)
	await act(() => hook.state().setHorizonDays('45'))
	await act(() => hook.state().deployAdmission())
	expect(hook.state().deploymentLocked).toBe(true)
	await act(() => {
		hook.state().startNewDeployment()
	})
	expect(hook.state().deploymentLocked).toBe(false)
	expect(hook.state().admissionAddress).toBeUndefined()
	expect(hook.state().horizonDays).toBe('30')
})

test('a prior fork closes setup and allows a new deployment', async () => {
	const { hook } = await renderWithDeploymentWallet(capitalClient(), true)
	await act(() => hook.state().deployAdmission())
	await act(() => hook.state().deploy())
	const snapshot = capitalSnapshot()
	const closed = {
		...model(),
		setup: { securityPool, owner, stage: 2, originUniverseId: 0n, originForkTime: 1n, chainId: 1, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash, timestamp: snapshot.timestamp },
	}
	await hook.setProps({ model: closed })
	expect(hook.state().preparationReason(3)).toContain('Setup is closed')
	expect(hook.state().canStartNewDeployment).toBe(true)
	await act(() => {
		hook.state().startNewDeployment()
	})
	expect(hook.state().deploymentLocked).toBe(false)
	expect(hook.state().deploymentPool).toBeUndefined()
})

function useSecurityPoolActionsWrapper(props: { model: ReturnType<typeof model>; parameters?: Parameters<typeof useSecurityPoolActions>[1]; deploying?: boolean }) {
	return useSecurityPoolActions(props.model, props.parameters ?? parameters, props.deploying)
}

test('the deployment form reads the proposed origin universe while Capital omits the read', async () => {
	const source = capitalClient()
	source.setRead('getForkTime', 1n)
	source.install()
	const base = model()
	const hook = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: base, deploying: false }))
	expect(source.reads.filter(read => read.name === 'getForkTime')).toHaveLength(0)
	await hook.setProps({ deploying: true })
	await waitFor(() => expect(hook.state().originForked).toBe(true))
	expect(source.reads.filter(read => read.name === 'getForkTime')).toHaveLength(1)
})

test('a winning vault is controlled by its bidder before and after automatic materialization', async () => {
	capitalClient().install()
	const snapshot = auctionCapitalSnapshot()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...model(), snapshot } })
	lifecycle.trackRendered(hook)
	expect(hook.state().ownerReason).toBeUndefined()
	await hook.setProps({ parameters: { ...parameters, accountAddress: token } })
	expect(hook.state().ownerReason).toContain('owner')
	const auctionVault = snapshot.auctionVault
	if (auctionVault === undefined) throw new Error('Missing auction authority')
	await hook.setProps({ parameters, model: { ...model(), snapshot: { ...snapshot, auctionVault: { ...auctionVault, materialized: false } } } })
	expect(hook.state().ownerReason).toBeUndefined()
})
test('individual capital actions execute through the authenticated auction vault and sweep returned assets to its bidder', async () => {
	const fixture = await auctionFixture()
	const snapshot = auctionCapitalSnapshot()
	const requests: { data?: Hex | undefined; to?: string | null | undefined }[] = []
	const writer = asWriteClient(createMockWriteClient(request => requests.push(request)))
	installActiveEnvironmentForTesting({ ...fixture.backend, createWriteClient: () => ({ ...writer, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }) })
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...model(), snapshot } })
	lifecycle.trackRendered(hook)
	const abi = parseAbi(['function claimEarnings(address recipient)', 'function executeAndSweep(address target,uint256 value,bytes data,address token,address recipient) payable returns(bytes)'])
	const data = encodeFunctionData({ abi, functionName: 'claimEarnings', args: [snapshot.owner] })
	await act(() => hook.state().runSecurityPoolAction('claimSecurityPoolEarnings', 'Claim earnings', () => ({ account: snapshot.owner, to: capital, value: 0n, data })))
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(1)
	const request = requests[0]
	if (request?.data === undefined) throw new Error('Missing vault execution')
	expect(request.to).toBe(snapshot.owner)
	expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'executeAndSweep', args: [capital, 0n, data, token, owner] })
	fixture.values['owner'] = token
	await act(() => hook.state().runSecurityPoolAction('claimSecurityPoolEarnings', 'Claim earnings', () => ({ account: snapshot.owner, to: capital, value: 0n, data })))
	expect(hook.state().error).toBeDefined()
	expect(requests).toHaveLength(1)
})
test('security pool refresh keeps actions usable with an authenticated snapshot', async () => {
	capitalClient().install()
	const base = model()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: base })
	lifecycle.trackRendered(hook)
	await hook.setProps({ model: { ...base, loading: true } })
	expect(hook.state().ownerReason).toBeUndefined()
	await hook.setProps({ model: { ...base, snapshot: undefined, loading: true } })
	expect(hook.state().ownerReason).toBe('Loading security pool…')
	expect(hook.state().registerReason).toBe('Loading security pool…')
	await hook.setProps({ model: base })
	expect(hook.state().ownerReason).toBeUndefined()
})
test('a pending action keeps its refresh gap loading until the transaction finishes', async () => {
	const source = capitalClient()
	const requests: { data?: Hex | undefined }[] = []
	const writer = asWriteClient(createMockWriteClient(request => requests.push(request)))
	installActiveEnvironmentForTesting({ ...source.backend, createWriteClient: () => ({ ...writer, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }) })
	const refresh = createDeferred<void>()
	let refreshing = false
	const base = {
		...model(),
		refresh: async () => {
			refreshing = true
			await refresh.promise
		},
	}
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: base })
	lifecycle.trackRendered(hook)
	const ownerReason = hook.state().ownerReason
	let pending: Promise<void> | undefined
	try {
		await act(() => {
			pending = hook.state().runSecurityPoolAction('depositSecurityPoolHealthRep', 'Deposit REP and save target', () => {
				if (ownerReason !== undefined) throw new Error(ownerReason)
				return { account: owner, to: securityPool, data: '0x' }
			})
		})
		await waitFor(() => expect(refreshing).toBe(true))
		await hook.setProps({ model: { ...base, snapshot: undefined, loading: false } })
		expect(hook.state().busy).toBe('depositSecurityPoolHealthRep')
		expect(hook.state().ownerReason).toBe('Loading security pool…')
		expect(requests).toHaveLength(1)
	} finally {
		await act(async () => {
			refresh.resolve()
			await pending
		})
	}
	expect(hook.state().busy).toBeUndefined()
	expect(hook.state().error).toBeUndefined()
	expect(hook.state().feedback).toBe('Transaction confirmed')
	expect(hook.state().ownerReason).toBe('Open a security pool first')
	await hook.setProps({ model: base })
	expect(hook.state().ownerReason).toBeUndefined()
})
test('owner availability preserves the empty state and prioritizes the wallet guard', async () => {
	capitalClient().install()
	const empty = { ...model(), snapshot: undefined }
	const props: Parameters<typeof useSecurityPoolActionsWrapper>[0] = { model: empty }
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, props)
	lifecycle.trackRendered(hook)
	expect(hook.state().ownerReason).toBe('Open a security pool first')
	await hook.setProps({ parameters: { ...parameters, accountAddress: undefined } })
	expect(hook.state().ownerReason).toBe('Connect a wallet before sending transactions.')
	await hook.setProps({ model: { ...empty, loading: true } })
	expect(hook.state().ownerReason).toBe('Connect a wallet before sending transactions.')
})
test('creation rejects invalid economics without changing the owner health target', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await act(() => {
		hook.state().setOriginInput(securityPool)
		hook.state().setEconomicsField('minimumCommitment', '0')
	})
	expect(hook.state().creationError).toContain('positive')
	expect(hook.state().economicsDraft).not.toHaveProperty('targetHealthPercent')
	expect(hook.state().economicsDraft).not.toHaveProperty('auctionReservePercent')
	await act(() => hook.state().setEconomicsField('minimumCommitment', '1'))
	expect(hook.state().creationError).toBeUndefined()
})

test('cached setup progress waits for verification before offering a transaction', async () => {
	capitalClient().install()
	const cached = { ...model(), setup: undefined, snapshot: undefined, savedSetupStage: 1, loading: true }
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: cached })
	lifecycle.trackRendered(hook)
	expect(hook.state().preparationReason(2)).toBe('Checking setup progress…')
	await hook.setProps({ model: { ...cached, loading: false, error: 'RPC unavailable' } })
	expect(hook.state().preparationReason(2)).toBe('Try again to verify the saved setup progress.')
})

test('setup advances one explicit stage and rejects a stale stage before wallet submission', async () => {
	const source = capitalClient()
	source.setSetupStage(1n)
	const requests: { data?: Hex | undefined }[] = []
	const writer = asWriteClient(createMockWriteClient(request => requests.push(request)))
	installActiveEnvironmentForTesting({ ...source.backend, createWriteClient: () => ({ ...writer, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }) })
	const base = model()
	const snapshot = capitalSnapshot()
	const setup = { securityPool, owner, stage: 1, originUniverseId: 0n, originForkTime: 0n, chainId: 1, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash, timestamp: snapshot.timestamp }
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...base, snapshot: undefined, setup } })
	lifecycle.trackRendered(hook)
	expect(hook.state().preparationReason(1)).toContain('complete')
	expect(hook.state().preparationReason(3)).toContain('previous')
	await act(() => hook.state().prepare(2))
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(1)
	const data = requests[0]?.data
	if (data === undefined) throw new Error('Missing setup transaction')
	expect(decodeFunctionData({ abi: parseAbi(['function prepareNext()']), data }).functionName).toBe('prepareNext')
	source.setSetupStage(2n)
	await act(() => hook.state().prepare(2))
	expect(hook.state().error).toContain('Setup advanced')
	expect(requests).toHaveLength(1)
	source.setSetupStage(1n)
	source.setRead('getForkTime', 900n)
	await act(() => hook.state().prepare(2))
	expect(hook.state().error).toContain('The origin universe has forked')
	expect(requests).toHaveLength(1)
	await hook.setProps({ model: { ...base, snapshot: undefined, setup: { ...setup, originForkTime: 900n } } })
	expect(hook.state().preparationReason(2)).toContain('The origin universe has forked')

	const watchlist = localEntityScopeForNetwork(MAINNET_NETWORK_PROFILE, 'statoblast', 'pool')
	expect(readFavoriteEntries(watchlist)).toEqual([])
	source.setRead('getForkTime', 0n)
	source.setSetupStage(3n)
	await hook.setProps({ deploying: true, model: { ...base, snapshot: undefined, setup: { ...setup, stage: 3 } } })
	await act(() => hook.state().prepare(4))
	expect(hook.state().error).toBeUndefined()
	expect(readFavoriteEntries(watchlist).map(entry => entry.id)).toEqual([securityPool.toLowerCase()])
})

test('presentation-only accounts explain refresh without enabling writes or replacing the wallet guard', async () => {
	capitalClient().install()
	const base = { ...model(), snapshot: undefined, presentationSnapshot: capitalSnapshot() }
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: base, parameters })
	lifecycle.trackRendered(hook)
	expect(hook.state().ownerReason).toBe('Position refresh pending.')
	await hook.setProps({ parameters: { ...parameters, accountAddress: undefined } })
	expect(hook.state().ownerReason).toBe('Connect a wallet before sending transactions.')
})

test('security pool creation rejects priority fees above the oracle funding bound before any transaction', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await act(() => hook.state().setPriorityFeeInput(formatUnits(MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS + 1n, 9)))
	expect(hook.state().creationError).toContain('Oracle priority fee exceeds the report funding limit.')
	await act(() => hook.state().setPriorityFeeInput(formatUnits(MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, 9)))
	expect(hook.state().creationError).toBeUndefined()
})

test('USDC creation validates the configured oracle floor in six-decimal collateral units', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await act(() => {
		hook.state().setCollateralSymbol('USDC')
		hook.state().setReportFloor('0.0000001')
	})
	expect(hook.state().deployReason).toContain('up to 6 decimal places')
	await act(() => {
		hook.state().setReportFloor('0.000001')
		hook.state().setEconomicsField('minimumCommitment', '100')
		hook.state().setEconomicsField('minimumPurchaseFee', '1')
	})
	expect(hook.state().deployReason).toContain('question rules first')
	await act(() => hook.state().setReportFloor('0'))
	expect(hook.state().deployReason).toContain('positive minimum report stake with up to 6 decimal places')
})
test('the origin universe follows the selected universe until the user edits it', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...model(), universeInput: '7' } })
	lifecycle.trackRendered(hook)
	expect(hook.state().originInput).toBe('7')
	await hook.setProps({ model: { ...model(), universeInput: '9' } })
	expect(hook.state().originInput).toBe('9')
	await act(() => hook.state().setOriginInput('3'))
	await hook.setProps({ model: { ...model(), universeInput: '11' } })
	expect(hook.state().originInput).toBe('3')
})

test('a forked origin stops creation before the paid admission deployment', async () => {
	const source = capitalClient()
	source.setRead('getForkTime', 1n)
	const { hook, requests } = await renderWithDeploymentWallet(source, true)
	await waitFor(() => expect(hook.state().originForked).toBe(true))
	expect(hook.state().creationError).toBeUndefined()
	expect(hook.state().admissionDeployReason).toContain('has forked')
	expect(hook.state().deployReason).toContain('has forked')
	await act(() => hook.state().deployAdmission())
	expect(requests).toHaveLength(0)
	expect(hook.state().error).toContain('has forked')
})

test('a universe that forks after the form checked it still stops at submission', async () => {
	const source = capitalClient()
	const { hook, requests } = await renderWithDeploymentWallet(source, true)
	await waitFor(() => expect(hook.state().admissionDeployReason).toBeUndefined())
	source.setRead('getForkTime', 1n)
	await act(() => hook.state().deployAdmission())
	expect(requests).toHaveLength(0)
	expect(hook.state().error).toContain('has forked')
	expect(hook.state().originForked).toBe(true)
	expect(hook.state().admissionDeployReason).toContain('has forked')
	expect(hook.state().deployReason).toContain('has forked')
})

test('a fork seen on one network does not block the same universe ID on another', async () => {
	const forkedNetwork = capitalClient()
	forkedNetwork.setRead('getForkTime', 1n)
	forkedNetwork.install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true })
	lifecycle.trackRendered(hook)
	await waitFor(() => expect(hook.state().originForked).toBe(true))
	const unforkedNetwork = capitalClient()
	unforkedNetwork.setRead('getForkTime', 0n)
	unforkedNetwork.install()
	await hook.setProps({ model: model() })
	await waitFor(() => expect(hook.state().originForked).toBe(false))
	expect(hook.state().admissionDeployReason).toBeUndefined()
})

test('a fork between the two paid deployments stops the security pool deployment', async () => {
	const source = capitalClient()
	const { hook, requests } = await renderWithDeploymentWallet(source)
	await act(() => hook.state().deployAdmission())
	expect(requests).toHaveLength(1)
	source.setRead('getForkTime', 1n)
	await act(() => hook.state().deploy())
	expect(requests).toHaveLength(1)
	expect(hook.state().error).toContain('has forked')
	expect(hook.state().deployReason).toContain('has forked')
})

test('changing collateral requires deliberate token-denominated economic amounts', async () => {
	capitalClient().install()
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model() })
	lifecycle.trackRendered(hook)
	await act(() => hook.state().setCollateralSymbol('USDC'))
	expect(hook.state().reportFloor).toBe('')
	expect(hook.state().economicsDraft.minimumCommitment).toBe('')
	expect(hook.state().economicsDraft.minimumPurchaseFee).toBe('')
	expect(hook.state().creationError).toBeDefined()
})

test('question registration is blocked outside the security pool horizon by chain time', async () => {
	const day = 86_400n
	const { timestamp: now, blockNumber } = capitalSnapshot()
	const { zoltarQuestionData } = getZoltarContractAddresses()
	const source = capitalClient()
	source.setRead('isQuestionAllowed', true)
	source.setRead('maximumQuestionHorizonSeconds', 30n * day)
	const { hook, requests } = await renderWithDeploymentWallet(source)
	const horizonReads = () => source.reads.filter(read => read.name === 'maximumQuestionHorizonSeconds' || read.name === 'getQuestionEndDate')
	const expectReason = async (questionId: string, endTime: bigint, reason: string | undefined) => {
		// Scoped to the question data contract, so an end-date read anywhere else fails as an unexpected read.
		source.setRead('getQuestionEndDate', endTime, zoltarQuestionData)
		await act(() => hook.state().setQuestionInput(questionId))
		if (reason === undefined) await waitFor(() => expect(hook.state().registerReason).toBeUndefined())
		else await waitFor(() => expect(hook.state().registerReason).toContain(reason))
	}
	await expectReason('7', now + day, undefined)
	await expectReason('8', now, 'has ended')
	await expectReason('9', 0n, 'does not exist')
	await expectReason('10', now + 30n * day + 1n, '30-day question horizon')
	const end = now + 30n * day
	await expectReason('11', end, undefined)
	const displayedReads = horizonReads()
	expect(displayedReads.filter(read => read.name === 'getQuestionEndDate').map(read => read.address)).toEqual(Array.from({ length: 5 }, () => zoltarQuestionData))
	expect(displayedReads.filter(read => read.name === 'maximumQuestionHorizonSeconds').map(read => read.address)).toEqual(Array.from({ length: 5 }, () => securityPool))
	expect(new Set(displayedReads.map(read => read.blockNumber))).toEqual(new Set([blockNumber]))
	// Chain time can reach the end between the displayed check and submission; the transaction lands at least one second after the latest block.
	source.setSnapshot(capitalSnapshot({ timestamp: end - 1n, blockNumber: blockNumber + 1n }))
	await act(() => hook.state().register())
	expect(requests).toHaveLength(0)
	expect(hook.state().error).toContain('has ended')
	const submitReads = horizonReads().slice(displayedReads.length)
	expect(new Set(submitReads.map(read => read.blockNumber))).toEqual(new Set([blockNumber + 1n]))
})

test('registration explains the question outcomes and fork threshold before signing', async () => {
	const now = capitalSnapshot().timestamp
	const source = capitalClient()
	source.setRead('isQuestionAllowed', true)
	source.setRead('maximumQuestionHorizonSeconds', 86_400n)
	source.setRead('getQuestionEndDate', now + 100n)
	source.setRead('getOutcomeLabels', ['Yes', 'No', 'Other'])
	source.setRead('getNonDecisionThresholdAttoRep', 2n * 10n ** 18n)
	source.setRead('getUniverseTheoreticalSupplyAttoRep', 1_000_000n * 10n ** 18n)
	const { hook, requests } = await renderWithDeploymentWallet(source)
	await act(() => {
		hook.state().setQuestionInput('7')
	})
	await waitFor(() => expect(hook.state().registerReason).toBe('Only questions with Yes and No outcomes can be registered'))
	source.setRead('getOutcomeLabels', ['Yes', 'No'])
	source.setRead('getNonDecisionThresholdAttoRep', 10n ** 18n)
	await act(() => {
		hook.state().setQuestionInput('8')
	})
	await waitFor(() => expect(hook.state().registerReason).toBe('This universe’s fork threshold is too low to register questions'))
	source.setRead('getNonDecisionThresholdAttoRep', 2n * 10n ** 18n)
	await act(() => {
		hook.state().setQuestionInput('9')
	})
	await waitFor(() => expect(hook.state().registerReason).toBeUndefined())
	await act(async () => {
		await hook.state().register()
	})
	expect(requests).toHaveLength(1)
	source.setRead('getOutcomeLabels', ['No', 'Yes'])
	await act(async () => {
		await hook.state().register()
	})
	expect(requests).toHaveLength(1)
	expect(hook.state().error).toContain('Only questions with Yes and No outcomes can be registered.')
})

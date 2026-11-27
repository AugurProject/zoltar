import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { formatUnits, getAddress } from '@zoltar/core-shared/evm/ethereum'
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
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, getCreateAddress, parseAbi, parseAbiItem, parseAbiParameters, toEventSelector, TransactionLookupNotFoundError, type Address, type Hash, type Hex, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { getInfraContractAddresses } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { recoverSecurityPoolDeployment } from '@zoltar/ui-statoblast-shared/protocol/deploymentRecovery.js'
import { initialDeploymentDraft } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/creation.js'
import { renderHookWithProps } from '../../support/renderHook.js'
import { capitalSnapshot, owner, securityPool, token, capital } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
import { getZoltarContractAddresses } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import { auctionFixture } from './auctionFixture.js'
const lifecycle = installDomTestLifecycle({
	beforeTest: ({ window }) => {
		let active: Promise<unknown> = Promise.resolve()
		Object.defineProperty(window.navigator, 'locks', {
			configurable: true,
			value: {
				request: (_name: string, callback: () => unknown) => {
					const next = active.then(callback)
					active = next.catch(() => undefined)
					return next
				},
			},
		})
	},
	afterTest: resetActiveEnvironmentForTesting,
})
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

function saveDeploymentMarker(source: ReturnType<typeof capitalClient>, pending: { step: 'rules' | 'pool'; nonce?: string; hash?: Hash; nonceVerified?: boolean }, rules?: Address) {
	const { network, persistence } = localEntityScopeForNetwork(source.backend.profile, 'statoblast', 'pool')
	const storage = persistence === 'session' ? window.sessionStorage : window.localStorage
	storage.setItem(`zoltar-ui:statoblast:deployment:v1:${network}:${owner.toLowerCase()}`, JSON.stringify({ draft: { ...initialDeploymentDraft('0'), horizonDays: '45' }, rules, pending: { id: 'saved-deployment', ...pending } }))
}

/** Renders the actions over `source` with an owner wallet that records each transaction, reports `token` as the first deployed contract and the factory's deployment event for `securityPool` after it. */
async function renderWithDeploymentWallet(
	source: ReturnType<typeof capitalClient>,
	deploying = false,
	delays: {
		wallet?: Promise<void>
		receipt?: Promise<void>
		confirmed?: () => boolean
		unrelatedReplacement?: () => void
		cancelled?: boolean
		chain?: (requests: readonly { to?: Address | null | undefined; data?: Hex | undefined }[]) => Partial<Pick<ReadClient, 'getBlock' | 'getStorageAt' | 'getTransaction' | 'getTransactionCount' | 'getTransactionReceipt'>>
	} = {},
) {
	// The factory creates the security pool, so the receipt carries no contract address for it: only the factory's event names it.
	const requests: { to?: Address | null | undefined; data?: Hex | undefined; nonce?: bigint | undefined }[] = []
	const receiptHashes: Hash[] = []
	const loaded: string[] = []
	const receipt = () => (requests.at(-1)?.to !== factory() ? { from: owner, to: undefined, status: 'success' as const, contractAddress: token, logs: [] } : { from: owner, to: factory(), status: 'success' as const, contractAddress: undefined, logs: [deployedPoolLog()] })
	const writer = asWriteClient({
		...createMockWriteClient(request => requests.push(request)),
		waitForTransactionReceipt: async ({ onReplaced }: Parameters<WriteClient['waitForTransactionReceipt']>[0]) => {
			if (delays.unrelatedReplacement !== undefined) {
				onReplaced?.({
					reason: delays.cancelled ? 'cancelled' : 'replaced',
					transaction: { hash: replacementHash },
					replacedTransaction: { hash: mockTransactionHash },
					transactionReceipt: { ...receipt(), transactionHash: replacementHash, blockHash: mockTransactionHash, blockNumber: 1n, cumulativeGasUsed: 1n, gasUsed: 1n, transactionIndex: 0n },
				})
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
				getTransactionCount: async () => 0n,
				getStorageAt: async () => '0x0' satisfies Hex,
				getTransaction: async ({ hash }) => {
					const sent = requests.at(-1)
					if (sent?.nonce === undefined || hash !== mockTransactionHash) throw new TransactionLookupNotFoundError('transaction', hash)
					return { from: owner, hash, nonce: sent.nonce, input: sent.data ?? '0x', gas: 1n, value: 0n }
				},
				getTransactionReceipt: async ({ hash }) => {
					receiptHashes.push(hash)
					if (delays.confirmed?.() !== true) throw new TransactionLookupNotFoundError('receipt', hash)
					return { ...receipt(), transactionHash: mockTransactionHash, blockHash: mockTransactionHash, blockNumber: 1n, cumulativeGasUsed: 1n, gasUsed: 1n, transactionIndex: 0n } satisfies TransactionReceipt
				},
				...delays.chain?.(requests),
			})),
		createWriteClient: (_, callbacks) => ({
			...writer,
			account: { address: owner, type: 'json-rpc' },
			chain: MAINNET_NETWORK_PROFILE.chain,
			call: async () => ({ data: undefined }),
			onTransactionSubmitted: callbacks?.onTransactionSubmitted,
			sendTransaction: async request => {
				await callbacks?.assertBeforeSubmit?.()
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
		expect(restored.state().pendingDeployment?.nonce).toBe('0')
		await act(() => restored.state().deployAdmission())
		expect(requests).toHaveLength(1)
	} finally {
		wallet.resolve()
		await sending
	}
})

test('the wizard checks the wallet nonce again before accepting a hashless rejection', async () => {
	const wallet = createDeferred<void>()
	let inMempool = false
	const nonce = 6n
	const reads: (string | undefined)[] = []
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true, {
		wallet: wallet.promise,
		chain: () => ({
			getTransactionCount: async ({ blockTag }) => {
				reads.push(blockTag)
				return blockTag === 'pending' && inMempool ? nonce + 1n : nonce
			},
		}),
	})
	let sending: Promise<void> | undefined
	try {
		await act(() => hook.state().setHorizonDays('45'))
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await waitFor(() => expect(requests).toHaveLength(1))
		await act(() => hook.cleanup())
		const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
		await waitFor(() => expect(restored.state().checkingDeploymentReceipt).toBe(false))
		expect(restored.state().pendingDeployment?.hash).toBeUndefined()
		expect(restored.state().admissionDeployReason).toMatch(/^Waiting for the wallet\. .*confirm or reject/)
		inMempool = true
		await act(() => restored.state().confirmWalletRejection())
		expect(restored.state().deploymentLocked).toBe(true)
		expect(restored.state().canStartNewDeployment).toBe(false)
		inMempool = false
		reads.length = 0
		await act(() => restored.state().confirmWalletRejection())
		expect(reads).toEqual([undefined, 'pending'])
		expect(restored.state().deploymentLocked).toBe(false)
		expect(restored.state().horizonDays).toBe('45')
	} finally {
		wallet.reject(Object.assign(new Error('User rejected request'), { code: 4001 }))
		await sending
	}
})

test('the wizard recovers question rules from a spent nonce without a saved hash', async () => {
	const wallet = createDeferred<void>()
	const source = capitalClient()
	const nonce = 6n
	let mined = false
	const rules = getCreateAddress({ from: owner, nonce })
	const code = source.codes.get(token)
	if (code === undefined) throw new Error('Missing mock question rules code')
	const { hook, requests, receiptHashes } = await renderWithDeploymentWallet(source, true, {
		wallet: wallet.promise,
		chain: () => ({ getTransactionCount: async () => (mined ? nonce + 1n : nonce) }),
	})
	let sending: Promise<void> | undefined
	try {
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await waitFor(() => expect(requests).toHaveLength(1))
		await act(() => hook.cleanup())
		source.codes.set(rules, code)
		mined = true
		const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
		await waitFor(() => expect(restored.state().admissionAddress).toBe(rules))
		expect(restored.state().pendingDeployment).toBeUndefined()
		expect(receiptHashes).toEqual([])
	} finally {
		wallet.reject(new Error('Wallet disconnected before returning a hash'))
		await sending
	}
})

test('the wizard will not send against an outdated wallet nonce', async () => {
	let nonceReads = 0n
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true, {
		chain: () => ({ getTransactionCount: async () => ++nonceReads }),
	})
	await act(() => hook.state().deployAdmission())
	expect(requests).toEqual([])
	expect(hook.state().deploymentLocked).toBe(false)
	expect(nonceReads).toBe(2n)
})

test.each([{ code: 4001 }, { data: { originalError: { code: 4001 } } }, { error: { data: { code: '4001' } } }])('an explicit wallet rejection unlocks the rules deployment again (%j)', async details => {
	const wallet = createDeferred<void>()
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true, { wallet: wallet.promise })
	let sending: Promise<void> | undefined
	await act(() => {
		sending = hook.state().deployAdmission()
	})
	await waitFor(() => expect(hook.state().deploymentLocked).toBe(true))
	await act(async () => {
		wallet.reject(Object.assign(new Error('User rejected request'), details))
		await sending
	})
	expect(hook.state().deploymentLocked).toBe(false)
	expect(hook.state().admissionDeployReason).toBeUndefined()
	expect(requests).toHaveLength(1)
})

test('a 4001 from receipt tracking keeps the submitted deployment marker', async () => {
	const receipt = createDeferred<void>()
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true, { receipt: receipt.promise })
	let sending: Promise<void> | undefined
	try {
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await waitFor(() => expect(hook.state().pendingDeployment?.hash).toBe(mockTransactionHash))
		receipt.reject(Object.assign(new Error('Wallet returned a rejection while checking the receipt'), { code: 4001 }))
		await act(async () => await sending)
		expect(hook.state().pendingDeployment?.hash).toBe(mockTransactionHash)
		expect(requests).toHaveLength(1)
	} finally {
		receipt.resolve()
		await sending
	}
})

test.each(['Hardware wallet disconnected', 'User rejected request'])('an ambiguous wallet send failure keeps the rules deployment locked (%s)', async failure => {
	const wallet = createDeferred<void>()
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true, { wallet: wallet.promise })
	let sending: Promise<void> | undefined
	await act(() => {
		sending = hook.state().deployAdmission()
	})
	await waitFor(() => expect(requests).toHaveLength(1))
	await act(async () => {
		wallet.reject(new Error(failure))
		await sending
	})
	expect(hook.state().pendingDeployment).toMatchObject({ step: 'rules', nonce: '0' })
	expect(hook.state().pendingDeployment?.hash).toBeUndefined()
	expect(hook.state().admissionDeployReason).toMatch(/^Waiting for the wallet\. .*confirm or reject/)
	expect(hook.state().canStartNewDeployment).toBe(false)
})

test('a spent nonce cannot unlock a restart or a rejection escape while the wallet has an outstanding transaction', async () => {
	const source = capitalClient()
	saveDeploymentMarker(source, { step: 'rules', nonce: '3' })
	let outstanding = true
	const { hook } = await renderWithDeploymentWallet(source, true, {
		chain: () => ({ getTransactionCount: async ({ blockTag }) => (blockTag === 'pending' && outstanding ? 5n : 4n) }),
	})
	await waitFor(() => expect(hook.state().checkingDeploymentReceipt).toBe(false))
	expect(hook.state().canStartNewDeployment).toBe(false)
	expect(hook.state().admissionDeployReason).toBe('Earlier transactions from this wallet are still pending or not yet final. Speed up or cancel them in your wallet, or wait about 15 minutes, then check again.')
	await act(() => hook.state().confirmWalletRejection())
	expect(hook.state().canStartNewDeployment).toBe(false)
	expect(hook.state().admissionDeployReason).toContain('Speed up or cancel them in your wallet')
	outstanding = false
	await act(() => hook.state().refreshDeploymentProgress())
	expect(hook.state().canStartNewDeployment).toBe(true)
	expect(hook.state().admissionDeployReason).toContain('reject it there before starting a new deployment.')
	outstanding = true
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(false))
	expect(hook.state().deploymentLocked).toBe(true)
	expect(hook.state().canStartNewDeployment).toBe(false)
})

test('a known deployment hash uses the nonce of its transaction instead of the saved RPC estimate', async () => {
	const source = capitalClient()
	saveDeploymentMarker(source, { step: 'rules', hash: mockTransactionHash, nonce: '3' })
	let visible = true
	let count = 4n
	const { hook } = await renderWithDeploymentWallet(source, true, {
		chain: () => ({
			getTransactionCount: async () => count,
			getTransaction: async ({ hash }) => {
				if (!visible) throw new TransactionLookupNotFoundError('transaction', hash)
				return { from: owner, input: '0x', nonce: 5n, gas: 1n, value: 0n, hash }
			},
		}),
	})
	await waitFor(() => expect(hook.state().checkingDeploymentReceipt).toBe(false))
	expect(hook.state().canStartNewDeployment).toBe(false)
	visible = true
	await act(() => hook.state().refreshDeploymentProgress())
	expect(hook.state().pendingDeployment?.nonce).toBe('5')
	expect(hook.state().canStartNewDeployment).toBe(false)
	visible = false
	count = 6n
	await act(() => hook.state().refreshDeploymentProgress())
	expect(hook.state().canStartNewDeployment).toBe(true)
})

test('Check again rechecks a deployment after showing how to release an estimated nonce', async () => {
	const source = capitalClient()
	saveDeploymentMarker(source, { step: 'rules', hash: mockTransactionHash, nonce: '9' })
	let count = 2n
	const { hook, receiptHashes } = await renderWithDeploymentWallet(source, true, {
		chain: () => ({ getTransactionCount: async () => count }),
	})
	await waitFor(() => expect(hook.state().checkingDeploymentReceipt).toBe(false))
	expect(hook.state().canStartNewDeployment).toBe(false)
	expect(hook.state().admissionDeployReason).toBe('If your wallet no longer shows this transaction, send or cancel a transaction with nonce 9 (or the nonce your wallet shows for it), then check again.')
	expect(receiptHashes).toEqual([mockTransactionHash])
	count = 10n
	await act(() => hook.state().refreshDeploymentProgress())
	expect(receiptHashes).toEqual([mockTransactionHash, mockTransactionHash])
	expect(hook.state().canStartNewDeployment).toBe(true)
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(true))
	expect(hook.state().deploymentLocked).toBe(false)
})

test('restart leaves a newer marker written by another tab before the lock was acquired', async () => {
	const source = capitalClient()
	saveDeploymentMarker(source, { step: 'rules', nonce: '3' })
	const { hook } = await renderWithDeploymentWallet(source, true, { chain: () => ({ getTransactionCount: async () => 4n }) })
	await waitFor(() => expect(hook.state().canStartNewDeployment).toBe(true))
	const locks = navigator.locks
	Object.defineProperty(navigator, 'locks', {
		configurable: true,
		value: {
			request: (name: string, callback: () => unknown) =>
				locks.request(name, () => {
					saveDeploymentMarker(source, { step: 'rules', hash: replacementHash, nonce: '4' })
					return callback()
				}),
		},
	})
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(false))
	expect(hook.state().pendingDeployment?.hash).toBe(replacementHash)
})

test('a dropped deployment with an unused verified nonce shows the exact nonce and wallet action', async () => {
	const source = capitalClient()
	saveDeploymentMarker(source, { step: 'rules', hash: mockTransactionHash, nonce: '6', nonceVerified: true })
	const { hook } = await renderWithDeploymentWallet(source, true, { chain: () => ({ getTransactionCount: async () => 6n }) })
	await waitFor(() => expect(hook.state().checkingDeploymentReceipt).toBe(false))
	expect(hook.state().admissionDeployReason).toBe('If your wallet no longer shows this transaction, send or cancel a transaction with nonce 6, then check again.')
	expect(hook.state().canStartNewDeployment).toBe(false)
})

test('a finalized reverted receipt offers restart without searching for a deployment at the saved nonce', async () => {
	const source = capitalClient()
	const { blockHash, blockNumber } = capitalSnapshot()
	saveDeploymentMarker(source, { step: 'rules', nonce: '6', hash: mockTransactionHash, nonceVerified: true })
	const lookup = mock(async () => {
		throw new Error('The transaction lookup is unavailable')
	})
	const { hook } = await renderWithDeploymentWallet(source, true, {
		chain: () => ({
			getTransaction: lookup,
			getTransactionCount: async () => 7n,
			getTransactionReceipt: async () => ({ status: 'reverted', blockHash, blockNumber, from: owner, to: undefined, contractAddress: undefined, transactionHash: mockTransactionHash, logs: [], cumulativeGasUsed: 1n, gasUsed: 1n, transactionIndex: 0n }),
		}),
	})
	await waitFor(() => expect(hook.state().canStartNewDeployment).toBe(true))
	expect(hook.state().admissionDeployReason).toContain('did not deploy')
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(true))
	expect(lookup).not.toHaveBeenCalled()
	expect(hook.state().deploymentLocked).toBe(false)
})

test('restart requires the new confirmation when the recovery warning changes', async () => {
	const source = capitalClient()
	const { blockHash, blockNumber } = capitalSnapshot()
	saveDeploymentMarker(source, { step: 'rules', hash: mockTransactionHash })
	let hasReceipt = true
	const { hook } = await renderWithDeploymentWallet(source, true, {
		chain: () => ({
			getTransactionReceipt: async ({ hash }) => {
				if (!hasReceipt) throw new TransactionLookupNotFoundError('receipt', hash)
				return { status: 'reverted', blockHash, blockNumber, from: owner, to: undefined, contractAddress: undefined, transactionHash: hash, logs: [], cumulativeGasUsed: 1n, gasUsed: 1n, transactionIndex: 0n }
			},
		}),
	})
	await waitFor(() => expect(hook.state().canStartNewDeployment).toBe(true))
	expect(hook.state().restartConfirmationWarning).toContain('reject it there')
	hasReceipt = false
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(false))
	expect(hook.state().restartConfirmationWarning).toBe('This transaction may still be pending in your wallet. Cancel it there before starting a new deployment.')
	expect(hook.state().pendingDeployment?.hash).toBe(mockTransactionHash)
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(true))
})

test('restarting a dropped pool send keeps the existing rules and form settings', async () => {
	const source = capitalClient()
	saveDeploymentMarker(source, { step: 'pool', nonce: '3' }, token)
	const { hook, requests } = await renderWithDeploymentWallet(source, true, {
		chain: () => ({ getTransactionCount: async ({ blockNumber }) => (blockNumber !== undefined && blockNumber < capitalSnapshot().blockNumber ? 3n : 4n) }),
	})
	await waitFor(() => expect(hook.state().canStartNewDeployment).toBe(true))
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(true))
	expect(hook.state().pendingDeployment).toBeUndefined()
	expect(hook.state().admissionAddress).toBe(token)
	expect(hook.state().horizonDays).toBe('45')
	expect(hook.state().deployReason).toBeUndefined()
	await act(() => hook.state().deploy())
	expect(requests).toHaveLength(1)
	expect(requests[0]?.to).toBe(factory())
})

test('a development journal without a nonce can be confirmed and restarted when the wallet is idle', async () => {
	const source = capitalClient()
	saveDeploymentMarker(source, { step: 'rules' })
	const { hook } = await renderWithDeploymentWallet(source, true)
	await waitFor(() => expect(hook.state().canStartNewDeployment).toBe(true))
	expect(hook.state().deploymentLocked).toBe(true)
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(true))
	expect(hook.state().pendingDeployment).toBeUndefined()
	expect(hook.state().horizonDays).toBe('45')
})

test('a pruned block read in recovery explains the archive option and allows a confirmed restart', async () => {
	const source = capitalClient()
	saveDeploymentMarker(source, { step: 'pool', nonce: '3' }, token)
	const { hook } = await renderWithDeploymentWallet(source, true, {
		chain: () => ({
			getTransactionCount: async ({ blockNumber }) => {
				if (blockNumber !== undefined && blockNumber < capitalSnapshot().blockNumber) throw new Error('missing trie node')
				return 4n
			},
		}),
	})
	await waitFor(() => expect(hook.state().canStartNewDeployment).toBe(true))
	expect(hook.state().deployReason).toBe('This RPC can’t check older blocks. Switch to an archive RPC or check your wallet activity.')
	expect(hook.state().deploymentLocked).toBe(true)
})

test.each(['0x6000', '0xef01000000000000000000000000000000000000000044'] as const)('a wallet with code can restart after checking wallet activity (%s)', async code => {
	const source = capitalClient()
	source.codes.set(owner, code)
	saveDeploymentMarker(source, { step: 'rules', nonce: '3' })
	const nonceRead = mock(async () => 4n)
	const { hook } = await renderWithDeploymentWallet(source, true, { chain: () => ({ getTransactionCount: nonceRead }) })
	await waitFor(() => expect(hook.state().canStartNewDeployment).toBe(true))
	expect(hook.state().admissionDeployReason).toContain('Check your wallet activity')
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(true))
	expect(hook.state().deploymentLocked).toBe(false)
	expect(nonceRead).not.toHaveBeenCalled()
})

test('restarting a delegated wallet rechecks the known hash and adopts a receipt that just arrived', async () => {
	const source = capitalClient()
	source.codes.set(owner, '0xef01000000000000000000000000000000000000000044')
	saveDeploymentMarker(source, { step: 'rules', hash: mockTransactionHash })
	let confirmed = false
	const { hook } = await renderWithDeploymentWallet(source, true, { confirmed: () => confirmed })
	await waitFor(() => expect(hook.state().canStartNewDeployment).toBe(true))
	confirmed = true
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(false))
	expect(hook.state().pendingDeployment).toBeUndefined()
	expect(hook.state().admissionAddress).toBe(token)
})

test('two wizard tabs wait for the same deployment lock before either can send', async () => {
	const lockHeld = createDeferred<void>()
	const releaseLock = createDeferred<void>()
	const lockName = `zoltar-ui:statoblast:deployment:v1:${localEntityScopeForNetwork(capitalClient().backend.profile, 'statoblast', 'pool').network}:${owner.toLowerCase()}`
	const lockManager = navigator.locks
	const request = mock((name: string, callback: () => unknown) => lockManager.request(name, callback))
	Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
	const occupied = request(lockName, async () => {
		lockHeld.resolve()
		await releaseLock.promise
	})
	await lockHeld.promise
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true)
	const otherTab = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
	let submissions: Promise<void>[] = []
	try {
		await act(() => {
			submissions = [hook.state().deployAdmission(), otherTab.state().deployAdmission()]
		})
		await waitFor(() => {
			expect(request.mock.calls.map(([name]) => name)).toEqual([lockName, lockName, lockName])
		})
		expect(requests).toHaveLength(0)
	} finally {
		releaseLock.resolve()
		await occupied
		await Promise.all(submissions)
	}
	expect(requests).toHaveLength(1)
})

function controlStorageWrites(canWrite: (value: string) => boolean, failure: 'quota' | 'ignored' = 'quota') {
	const storage = window.localStorage
	const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => storage.getItem(key),
			setItem: (key: string, value: string) => {
				if (canWrite(value)) storage.setItem(key, value)
				else if (failure === 'quota') throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
			},
			removeItem: (key: string) => storage.removeItem(key),
		},
	})
	return () => {
		if (descriptor !== undefined) Object.defineProperty(window, 'localStorage', descriptor)
		else Reflect.deleteProperty(window, 'localStorage')
	}
}

test.each(['quota', 'ignored'] as const)('readable storage must save the deployment marker before the wallet opens (%s)', async failure => {
	let canWrite = false
	const restoreStorage = controlStorageWrites(() => canWrite, failure)
	try {
		const source = capitalClient()
		const backend = failure === 'quota' ? { ...source.backend, profile: { ...source.backend.profile, genesisRepTokenAddress: capital } } : source.backend
		const { hook, requests } = await renderWithDeploymentWallet({ ...source, backend }, true)
		await act(() => hook.state().deployAdmission())
		expect(requests).toHaveLength(0)
		expect(hook.state().error).toBe('Could not save deployment progress. Free up browser storage or check its permissions, then try again.')
		expect(hook.state().pendingDeployment).toBeUndefined()
		expect(hook.state().deploymentProgressPersistent).toBe(true)
		canWrite = true
		await act(() => hook.state().deployAdmission())
		expect(requests).toHaveLength(1)
		expect(hook.state().admissionAddress).toBe(token)
	} finally {
		restoreStorage()
	}
})

test('a browser without Web Locks shows a deployment blocker before review', async () => {
	Object.defineProperty(window.navigator, 'locks', { configurable: true, value: undefined })
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true)
	const reason = 'This browser cannot coordinate deployment across tabs. Open this page in a browser that supports Web Locks.'
	expect(hook.state().admissionDeployReason).toBe(reason)
	expect(hook.state().deployReason).toBe(reason)
	await act(() => hook.state().deployAdmission())
	expect(hook.state().error).toBe(reason)
	expect(requests).toHaveLength(0)
})

test('removing Web Locks during validation prevents the wallet send with an actionable error', async () => {
	let nonceReads = 0
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true, {
		chain: () => ({
			getTransactionCount: async () => {
				if (++nonceReads === 2) Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
				return 0n
			},
		}),
	})
	expect(hook.state().admissionDeployReason).toBeUndefined()
	await act(() => hook.state().deployAdmission())
	expect(requests).toHaveLength(0)
	expect(hook.state().error).toBe('This browser cannot coordinate deployment across tabs. Open this page in a browser that supports Web Locks.')
})

test('post-claim write failures retain the durable claim and allow a writable retry from the original tab', async () => {
	const wallet = createDeferred<void>()
	let failWrites = false
	let sending: Promise<void> | undefined
	const restoreStorage = controlStorageWrites(() => !failWrites)
	try {
		const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true, { wallet: wallet.promise })
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await waitFor(() => expect(requests).toHaveLength(1))
		failWrites = true
		// A healthy tab can still read the original claim from shared storage.
		restoreStorage()
		const healthy = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
		await act(async () => {
			wallet.resolve()
			await sending
		})
		expect(hook.state().deploymentProgressPersistent).toBe(true)
		expect(hook.state().deploymentPersistenceWarning).toBe("Progress couldn't be saved. Keep this tab open until setup finishes, and don't deploy from another tab.")
		expect(hook.state().admissionAddress).toBe(token)
		await act(() => healthy.state().refreshDeploymentProgress())
		expect(healthy.state().admissionAddress).toBeUndefined()
		expect(healthy.state().pendingDeployment).toMatchObject({ step: 'rules' })
		await act(() => healthy.state().deployAdmission())
		expect(requests).toHaveLength(1)
		failWrites = false
		await act(() => hook.state().deploy())
		expect(requests).toHaveLength(2)
		expect(hook.state().deploymentPool).toBe(securityPool)
		expect(hook.state().deploymentPersistenceWarning).toBeUndefined()
	} finally {
		wallet.resolve()
		await sending
		restoreStorage()
	}
})

test('restart can clear an unchanged durable claim after a hash save failed and storage recovers', async () => {
	const receipt = createDeferred<void>()
	let confirmedNonce = 0n
	let sending: Promise<void> | undefined
	const restoreStorage = controlStorageWrites(value => confirmedNonce !== 0n || !value.includes(mockTransactionHash))
	try {
		const { hook } = await renderWithDeploymentWallet(capitalClient(), true, {
			receipt: receipt.promise,
			chain: () => ({
				getTransactionCount: async () => confirmedNonce,
				getTransaction: async ({ hash }) => {
					throw new TransactionLookupNotFoundError('transaction', hash)
				},
			}),
		})
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await waitFor(() => expect(hook.state().pendingDeployment?.hash).toBe(mockTransactionHash))
		receipt.reject(new Error('RPC unavailable'))
		await act(async () => await sending)
		expect(hook.state().deploymentPersistenceWarning).toBeDefined()
		confirmedNonce = 1n
		await act(() => hook.state().refreshDeploymentProgress())
		expect(hook.state().canStartNewDeployment).toBe(true)
		await act(async () => expect(await hook.state().startNewDeployment()).toBe(true))
		expect(hook.state().deploymentLocked).toBe(false)
		expect(hook.state().deploymentPersistenceWarning).toBeUndefined()
	} finally {
		receipt.resolve()
		await sending
		restoreStorage()
	}
})

test('a failed deployment count read prevents a pool send and can be retried', async () => {
	let canReadCount = false
	const { hook, requests } = await renderWithDeploymentWallet(capitalClient(), true, {
		chain: () => ({
			getStorageAt: async () => {
				if (!canReadCount) throw new Error('RPC unavailable')
				return '0x0'
			},
		}),
	})
	await act(() => hook.state().deployAdmission())
	expect(requests).toHaveLength(1)
	await act(() => hook.state().deploy())
	expect(requests).toHaveLength(1)
	expect(hook.state().error).toBe('Could not check previous security pool deployments. Try the deployment again.')
	expect(hook.state().pendingDeployment).toBeUndefined()
	canReadCount = true
	await act(() => hook.state().deploy())
	expect(requests).toHaveLength(2)
	expect(hook.state().error).toBeUndefined()
})

test('the wizard can finish deployment without persistent storage', async () => {
	const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
	const wallet = createDeferred<void>()
	let sending: Promise<void> | undefined
	Object.defineProperty(window, 'localStorage', {
		configurable: true,
		get: () => {
			throw new DOMException('Storage access denied', 'SecurityError')
		},
	})
	try {
		const source = capitalClient()
		const backend = { ...source.backend, profile: { ...source.backend.profile, genesisRepTokenAddress: token } }
		const { hook, requests } = await renderWithDeploymentWallet({ ...source, backend }, true, { wallet: wallet.promise })
		expect(hook.state().deploymentProgressPersistent).toBe(false)
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await waitFor(() => expect(requests).toHaveLength(1))
		await act(() => hook.cleanup())
		const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
		expect(restored.state().pendingDeployment?.step).toBe('rules')
		await restored.setProps({ parameters: { ...parameters, accountAddress: token } })
		expect(restored.state().pendingDeployment).toBeUndefined()
		await restored.setProps({ parameters })
		expect(restored.state().pendingDeployment?.step).toBe('rules')
		await act(() => restored.state().deployAdmission())
		expect(requests).toHaveLength(1)
		await act(async () => {
			wallet.resolve()
			await sending
		})
		expect(restored.state().admissionAddress).toBe(token)
		await act(() => restored.state().deploy())
		expect(restored.state().deploymentPool).toBe(securityPool)
		expect(requests).toHaveLength(2)
		const snapshot = capitalSnapshot()
		await restored.setProps({ model: { ...model(), setup: { securityPool, owner, stage: 4, originUniverseId: 0n, originForkTime: 0n, chainId: 1, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash, timestamp: snapshot.timestamp } } })
		await act(async () => expect(await restored.state().startNewDeployment()).toBe(true))
	} finally {
		wallet.resolve()
		await sending
		if (descriptor === undefined) Reflect.deleteProperty(window, 'localStorage')
		else Object.defineProperty(window, 'localStorage', descriptor)
	}
})

test('discard cannot remove a pool saved by a different wizard tab', async () => {
	const { hook } = await renderWithDeploymentWallet(capitalClient(), true)
	await act(() => hook.state().deployAdmission())
	expect(hook.state().canStartNewDeployment).toBe(true)
	const otherTab = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
	await act(() => otherTab.state().deploy())
	expect(otherTab.state().deploymentPool).toBe(securityPool)
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(false))
	const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
	expect(restored.state().deploymentPool).toBe(securityPool)
})

test('a saved deployment hash does not keep the wizard locked after a different transaction spends its nonce', async () => {
	const receipt = createDeferred<void>()
	let replaced = false
	let finalized = false
	let originalVisible = true
	const nonce = 3n
	const originalBlock = capitalSnapshot().blockNumber
	const replacementBlock = originalBlock + 1n
	const source = capitalClient()
	const { hook, requests } = await renderWithDeploymentWallet(source, true, {
		receipt: receipt.promise,
		chain: requests => ({
			getTransaction: async ({ hash }) => {
				if (!originalVisible) throw new TransactionLookupNotFoundError('transaction', hash)
				return { from: owner, input: requests[0]?.data ?? '0x', nonce, gas: 1n, value: 0n, hash: mockTransactionHash }
			},
			getTransactionCount: async request => (replaced && (request.blockNumber === undefined || request.blockNumber >= replacementBlock) ? nonce + 1n : nonce),
			getBlock: async request => ({
				...(await source.client.getBlock()),
				number: request?.blockNumber ?? ((request?.blockTag === 'finalized' ? finalized : replaced) ? replacementBlock : originalBlock),
			}),
		}),
	})
	let sending: Promise<void> | undefined
	try {
		await act(() => hook.state().setHorizonDays('45'))
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await waitFor(() => expect(hook.state().pendingDeployment?.hash).toBe(mockTransactionHash))
		await waitFor(() => expect(hook.state().pendingDeployment?.nonce).toBe(nonce.toString()))
		await act(() => hook.cleanup())
		originalVisible = false
		const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
		await act(() => restored.state().refreshDeploymentProgress())
		expect(restored.state().canStartNewDeployment).toBe(false)
		await waitFor(() => expect(restored.state().checkingDeploymentReceipt).toBe(false))
		replaced = true
		await act(() => restored.state().refreshDeploymentProgress())
		expect(restored.state().canStartNewDeployment).toBe(false)
		finalized = true
		await act(() => restored.state().refreshDeploymentProgress())
		await waitFor(() => expect(restored.state().canStartNewDeployment).toBe(true))
		expect(restored.state().admissionAddress).toBeUndefined()
		expect(requests).toHaveLength(1)
		await act(async () => expect(await restored.state().startNewDeployment()).toBe(true))
		expect(restored.state().admissionDeployReason).toBeUndefined()
		expect(restored.state().horizonDays).toBe('45')
	} finally {
		receipt.resolve()
		await sending
	}
})

for (const poolExists of [false, true]) {
	test(`pool deployment recovery checks a hash invisible to the RPC when ${poolExists ? 'the replacement deployed the pool' : 'no pool was created'}`, async () => {
		const receipt = createDeferred<void>()
		let consumed = false
		const source = capitalClient()
		const { hook, requests } = await renderWithDeploymentWallet(source, true, {
			wallet: Promise.resolve(),
			receipt: receipt.promise,
			chain: () => ({
				getTransaction: async ({ hash }) => {
					throw new TransactionLookupNotFoundError('transaction', hash)
				},
				getTransactionCount: async () => (consumed ? 2n : 1n),
				getStorageAt: async () => (consumed && poolExists ? '0x1' : '0x0'),
			}),
		})
		let sending: Promise<void> | undefined
		try {
			await act(() => hook.state().deployAdmission())
			await act(() => {
				sending = hook.state().deploy()
			})
			await waitFor(() => expect(hook.state().pendingDeployment?.hash).toBe(mockTransactionHash))
			expect(hook.state().pendingDeployment?.nonceVerified).not.toBe(true)
			await act(() => hook.cleanup())
			const load = mock(async (_pool?: string) => undefined)
			const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...model(), load }, deploying: true }))
			await waitFor(() => expect(restored.state().checkingDeploymentReceipt).toBe(false))
			expect(restored.state().canStartNewDeployment).toBe(false)
			consumed = true
			await act(() => restored.state().refreshDeploymentProgress())
			expect(restored.state().canStartNewDeployment).toBe(!poolExists)
			if (poolExists) {
				const candidate = source.reads.find(call => call.address === factory() && call.name === 'isSecurityPool')?.args?.[0]
				if (typeof candidate !== 'string') throw new Error('Expected the factory to verify a pool address')
				const verifiedPool = getAddress(candidate)
				expect(restored.state().deploymentPool).toBe(verifiedPool)
				expect(load.mock.calls[0]?.[0]).toBe(verifiedPool)
			} else expect(restored.state().deploymentPool).toBeUndefined()
			expect(requests).toHaveLength(2)
		} finally {
			receipt.resolve()
			await sending
		}
	})
}

test('one wizard tab recovers a pool using the draft another tab just saved', async () => {
	const receipt = createDeferred<void>()
	const source = capitalClient()
	let mined = false
	const chain = {
		getTransactionCount: async () => (mined ? 2n : 1n),
		getStorageAt: async (): Promise<Hex> => (mined ? '0x1' : '0x0'),
	}
	const { hook: oldTab, requests, loaded } = await renderWithDeploymentWallet(source, true, { wallet: Promise.resolve(), receipt: receipt.promise, chain: () => chain })
	const otherTab = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
	let sending: Promise<void> | undefined
	try {
		await act(() => {
			otherTab.state().setOriginInput('7')
			otherTab.state().setHorizonDays('45')
		})
		await act(() => otherTab.state().deployAdmission())
		await act(() => {
			sending = otherTab.state().deploy()
		})
		await waitFor(() => expect(otherTab.state().pendingDeployment?.hash).toBe(mockTransactionHash))
		expect(oldTab.state().horizonDays).toBe('30')
		const sent = requests[1]
		if (sent?.to === undefined || sent.to === null || sent.data === undefined) throw new Error('Expected the other tab to send a pool deployment')
		mined = true
		const readClient = source.client.extend(() => chain)
		const deployed = await recoverSecurityPoolDeployment(readClient, owner, 1n, { to: sent.to, data: sent.data }, 0n)
		const expectedPool = deployed?.pool
		if (expectedPool === undefined) throw new Error('Expected a candidate derived from the submitted transaction')
		await act(() => oldTab.state().refreshDeploymentProgress())
		expect(oldTab.state().deploymentPool).toBe(expectedPool)
		expect(loaded).toEqual([expectedPool])
		expect(oldTab.state().canStartNewDeployment).toBe(false)
	} finally {
		receipt.resolve()
		await sending
	}
})

test('verified question rules are recovered at the wallet’s mined creation address', async () => {
	const receipt = createDeferred<void>()
	const nonce = 4n
	let mined = false
	const source = capitalClient()
	const recoveredAddress = getCreateAddress({ from: owner, nonce })
	const code = source.codes.get(token)
	if (code === undefined) throw new Error('Missing mock question rules code')
	const { hook, requests } = await renderWithDeploymentWallet(source, true, {
		receipt: receipt.promise,
		chain: requests => ({
			getTransaction: async () => ({ from: owner, input: requests[0]?.data ?? '0x', nonce, gas: 1n, value: 0n, hash: mockTransactionHash }),
			getTransactionCount: async () => (mined ? nonce + 1n : nonce),
		}),
	})
	let sending: Promise<void> | undefined
	try {
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await waitFor(() => expect(hook.state().pendingDeployment?.nonce).toBe(nonce.toString()))
		await act(() => hook.cleanup())
		const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
		await waitFor(() => expect(restored.state().checkingDeploymentReceipt).toBe(false))
		expect(restored.state().admissionAddress).toBeUndefined()
		source.codes.set(recoveredAddress, code)
		mined = true
		await act(() => restored.state().refreshDeploymentProgress())
		await waitFor(() => expect(restored.state().admissionAddress).toBe(recoveredAddress))
		expect(restored.state().pendingDeployment).toBeUndefined()
		expect(requests).toHaveLength(1)
	} finally {
		receipt.resolve()
		await sending
	}
})

test.each([false, true])('a replacement is saved but cannot be mistaken for the rules deployment (cancelled: %s)', async cancelled => {
	const receipt = createDeferred<void>()
	const replaced = createDeferred<void>()
	const { hook, receiptHashes } = await renderWithDeploymentWallet(capitalClient(), true, {
		receipt: receipt.promise,
		cancelled,
		unrelatedReplacement: () => replaced.resolve(),
		chain: () => ({
			getTransactionReceipt: async ({ hash }) => {
				receiptHashes.push(hash)
				return { status: 'success', transactionHash: hash, from: owner, to: owner, blockHash: capitalSnapshot().blockHash, blockNumber: capitalSnapshot().blockNumber, contractAddress: token, logs: [], cumulativeGasUsed: 1n, gasUsed: 1n, transactionIndex: 0n }
			},
		}),
	})
	let sending: Promise<void> | undefined
	try {
		await act(() => {
			sending = hook.state().deployAdmission()
		})
		await replaced.promise
		await act(() => hook.cleanup())
		const restored = lifecycle.trackRendered(await renderHookWithProps(useSecurityPoolActionsWrapper, { model: model(), deploying: true }))
		expect(restored.state().admissionAddress).toBeUndefined()
		expect(restored.state().pendingDeployment?.hash).toBe(replacementHash)
		await waitFor(() => expect(restored.state().canStartNewDeployment).toBe(true))
		expect(restored.state().admissionAddress).toBeUndefined()
		expect(receiptHashes).toContain(replacementHash)
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
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(true))
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
	await act(async () => expect(await hook.state().startNewDeployment()).toBe(true))
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

test('an auction winner controls its own capital account directly from the connected wallet', async () => {
	capitalClient().install()
	const snapshot = capitalSnapshot({ unclaimedRepairAuctionBids: 1n })
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...model(), snapshot } })
	lifecycle.trackRendered(hook)
	expect(hook.state().ownerReason).toBeUndefined()
	await hook.setProps({ parameters: { ...parameters, accountAddress: token } })
	expect(hook.state().ownerReason).toContain('owner')
})
test('capital actions with unclaimed auction bids are sent unchanged by the owner to the capital ledger', async () => {
	const fixture = await auctionFixture()
	const snapshot = capitalSnapshot({ unclaimedRepairAuctionBids: 1n })
	const requests: { data?: Hex | undefined; to?: string | null | undefined }[] = []
	const writer = asWriteClient(createMockWriteClient(request => requests.push(request)))
	installActiveEnvironmentForTesting({ ...fixture.backend, createWriteClient: () => ({ ...writer, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }) })
	const hook = await renderHookWithProps(useSecurityPoolActionsWrapper, { model: { ...model(), snapshot } })
	lifecycle.trackRendered(hook)
	const abi = parseAbi(['function claimEarnings(address recipient)'])
	const data = encodeFunctionData({ abi, functionName: 'claimEarnings', args: [owner] })
	await act(() => hook.state().runSecurityPoolAction('claimSecurityPoolEarnings', 'Claim earnings', () => ({ account: owner, to: capital, value: 0n, data })))
	expect(hook.state().error).toBeUndefined()
	expect(requests).toHaveLength(1)
	expect(requests[0]?.to).toBe(capital)
	expect(requests[0]?.data).toBe(data)
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
	expect(hook.state().deployReason).toContain('positive minimum report collateral amount with up to 6 decimal places')
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

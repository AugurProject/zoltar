import { expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createPublicClient, custom, decodeFunctionData, getAddress, parseAbi, zeroAddress, zeroHash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { asWriteClient, createMockReadClient, createMockWriteClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { ChainBackend, TransactionPlanStep } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { vaultArtifact, type loadPortfolioPolicy } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { usePortfolioActions } from '@zoltar/ui-statoblast-shared/features/portfolios/hooks/usePortfolioActions.js'
import { renderHookWithProps } from '../../support/renderHook.js'

const owner = getAddress('0x0000000000000000000000000000000000000011')
const manager = getAddress('0x0000000000000000000000000000000000000022')
const vault = getAddress('0x0000000000000000000000000000000000000033')
const lifecycle = installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })
const parameters = { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }
const selectedModel: Parameters<typeof usePortfolioActions>[0] = {
	managerInput: manager,
	ownerInput: owner,
	selection: { owner, portfolio: manager, vault, originUniverseId: 0n },
	snapshot: { chainId: 1, blockNumber: 1n, blockHash: zeroHash, timestamp: 1000n, portfolio: manager, vault, owner, originUniverseId: 0n, questions: [5n], coverage: { complete: true, registryComplete: true, issues: [], scope: 'registered-and-explicit-pools' }, branches: [] },
	loading: false,
	error: undefined,
	refresh: async () => undefined,
	load: async () => undefined,
}

const latestBlock = { timestamp: '0x3e8', gasLimit: '0x0', gasUsed: '0x0', difficulty: '0x0', number: '0x1', hash: zeroHash, transactions: [] }
type Policy = Awaited<ReturnType<typeof loadPortfolioPolicy>>
const observedPolicy: Policy = {
	version: 7n,
	nonce: 2n,
	config: { universeId: 0n, executor: owner, expiresAt: 2000000000n, depositBudgetAttoRep: 200n * 10n ** 18n, commitmentIncreaseBudgetAttoEth: 2n * 10n ** 18n, minimumIdleAttoRep: 0n, minimumHealthFactorBps: 12000n },
	repToken: owner,
	spentDepositAttoRep: 25n * 10n ** 18n,
	spentCommitmentIncreaseAttoEth: 10n ** 18n,
}

function createExportBackend(
	readBlock: () => Promise<unknown> = async () => {
		throw new Error('Unexpected block read')
	},
	readChainId: () => Promise<number> = async () => 1,
	readPolicy: () => Promise<Policy> = async () => observedPolicy,
) {
	const client = createPublicClient({
		transport: custom({
			request: async ({ method }) => {
				if (method === 'eth_getBlockByNumber') return await readBlock()
				throw new Error(`Unexpected RPC call: ${method}`)
			},
		}),
	}).extend(() => ({
		getChainId: readChainId,
		...createMockReadClient(async request => {
			if (request.functionName === 'questionId') return 5n
			if (request.functionName === 'balanceOf') return 1000n * 10n ** 18n
			const policy = await readPolicy()
			if (request.functionName === 'allocationPolicy') return [policy.config, policy.repToken, policy.spentDepositAttoRep, policy.spentCommitmentIncreaseAttoEth]
			if (request.functionName === 'allocationPolicyVersion') return policy.version
			if (request.functionName === 'allocationPolicyNonce') return policy.nonce
			throw new Error(`Unexpected policy read: ${request.functionName}`)
		}),
	}))
	return { ...createFakeBackend({ accountAddress: owner }), createReadClient: () => client }
}

async function renderActions(readBlock?: () => Promise<unknown>, readChainId?: () => Promise<number>, readPolicy?: () => Promise<Policy>, createWriteClient?: ChainBackend['createWriteClient']) {
	const backend = createExportBackend(readBlock, readChainId, readPolicy)
	installActiveEnvironmentForTesting({ ...backend, ...(createWriteClient === undefined ? {} : { createWriteClient }) })
	const hook = lifecycle.trackRendered(await renderHookWithProps(({ model, universe }: { model: typeof selectedModel; universe: bigint }) => usePortfolioActions(model, parameters, universe), { model: selectedModel, universe: 0n }))
	await act(async () => {
		hook.state().setDraft(5n, { selected: true, deposit: '100' })
		await hook.state().exportCreate()
	})
	return hook
}

async function preparePolicy(hook: Awaited<ReturnType<typeof renderActions>>) {
	await act(() => {
		hook.state().setExecutor(owner)
		hook.state().setDepositBudget('200')
		hook.state().setCommitmentBudget('0')
	})
}

for (const universe of [0n, 9n]) {
	test(`funding native recovery in universe ${universe} reviews vault custody without promising shared underwriting`, async () => {
		const repToken = getAddress('0x0000000000000000000000000000000000000055')
		const plans: TransactionPlanStep[] = []
		const sent: { to?: `0x${string}` | null | undefined; data?: Hex | undefined; value?: bigint | undefined }[] = []
		const client = asWriteClient(createMockWriteClient(request => sent.push(request)))
		const hook = await renderActions(undefined, undefined, undefined, () => ({ ...client, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }), onTransactionPlan: steps => plans.push(...steps) }))
		if (selectedModel.snapshot === undefined) throw new Error('Expected recovery snapshot')
		await hook.setProps({ model: { ...selectedModel, snapshot: { ...selectedModel.snapshot, branches: [{ universeId: universe, repToken, idleAttoRep: 0n, forkTime: 0n, positions: [] }] } }, universe })
		await act(async () => {
			hook.state().setFundingAmount('12.5')
			await hook.state().fund()
		})
		expect(hook.state().error).toBeUndefined()
		expect(plans).toHaveLength(1)
		expect(sent).toHaveLength(1)
		const review = plans[0]
		if (review?.data === undefined) throw new Error('Expected recovery transfer review')
		expect(review.requireReview).toBe(true)
		expect(review.contractAddress).toBe(repToken)
		expect(sent[0]).toMatchObject({ to: repToken, data: review.data, value: 0n })
		expect(decodeFunctionData({ abi: parseAbi(['function transfer(address recipient,uint256 amount)']), data: review.data })).toMatchObject({ functionName: 'transfer', args: [vault, 125n * 10n ** 17n] })
		expect(review.reviewDescription).toContain(`Transfer 12.5 REP from ${owner} to recovery vault ${vault} in universe ${universe}`)
		expect(review.reviewDescription).toContain('manual or delegated recovery operations')
		expect(review.reviewDescription).toContain('does not buy shared fund shares or supply shared mint capacity')
		expect(review.reviewDescription).not.toMatch(/automatic backing|fee settings/i)
	})
}

test('revoking executor authority reviews only recovery custody and leaves shared underwriting intact', async () => {
	const plans: TransactionPlanStep[] = []
	const sent: { to?: `0x${string}` | null | undefined; data?: Hex | undefined; value?: bigint | undefined }[] = []
	const client = asWriteClient(createMockWriteClient(request => sent.push(request)))
	const hook = await renderActions(undefined, undefined, undefined, () => ({ ...client, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }), onTransactionPlan: steps => plans.push(...steps) }))
	await act(async () => await hook.state().revokePolicy())
	expect(hook.state().error).toBeUndefined()
	expect(plans).toHaveLength(1)
	expect(sent).toHaveLength(1)
	const review = plans[0]
	if (review?.data === undefined) throw new Error('Expected recovery revocation review')
	expect(review.requireReview).toBe(true)
	expect(review.contractAddress).toBe(vault)
	expect(sent[0]).toMatchObject({ to: vault, data: review.data, value: 0n })
	expect(decodeFunctionData({ abi: vaultArtifact.abi, data: review.data })).toMatchObject({ functionName: 'revokeAllocationPolicy' })
	expect(review.reviewDescription).toContain(`Revoke executor authority over recovery vault ${vault}`)
	expect(review.reviewDescription).toContain('Existing question positions and shared fund ownership and allocations remain unchanged')
	expect(review.reviewDescription).not.toContain('Automatic backing')
})

const policyEdits: readonly { field: string; edit: (actions: ReturnType<typeof usePortfolioActions>) => void }[] = [
	{ field: 'reserve', edit: actions => actions.setReserve('25') },
	{ field: 'health', edit: actions => actions.setHealth('15000') },
	{ field: 'executor', edit: actions => actions.setExecutor(vault) },
	{ field: 'expiry', edit: actions => actions.setExpiryHours('48') },
	{ field: 'deposit budget', edit: actions => actions.setDepositBudget('201') },
	{ field: 'commitment budget', edit: actions => actions.setCommitmentBudget('2') },
	{ field: 'question allocation', edit: actions => actions.setDraft(5n, { deposit: '101' }) },
]

for (const { field, edit } of policyEdits) {
	test(`clears an exported policy after the ${field} changes`, async () => {
		const hook = await renderActions(async () => latestBlock)
		await preparePolicy(hook)
		await act(async () => {
			await hook.state().exportPolicy()
		})
		expect(hook.state().exported).toContain(vault)
		await act(() => edit(hook.state()))
		expect(hook.state().exported).toBeUndefined()
	})

	test(`discards a pending policy export after the ${field} changes`, async () => {
		const block = createDeferred<unknown>()
		const hook = await renderActions(() => block.promise)
		await preparePolicy(hook)
		await act(() => hook.state().setDraft(5n, { deposit: '100' }))
		const exporting = hook.state().exportPolicy()
		await act(() => edit(hook.state()))
		await act(async () => {
			block.resolve(latestBlock)
			await exporting
		})
		expect(hook.state().exported).toBeUndefined()
		expect(hook.state().error).toBeUndefined()
	})
}

test('requires observed policy authority before exporting a replacement', async () => {
	const loadingPolicy = createDeferred<Policy>()
	const hook = await renderActions(
		async () => latestBlock,
		undefined,
		() => loadingPolicy.promise,
	)
	await preparePolicy(hook)
	await act(async () => {
		hook.state().setDraft(5n, { deposit: '100' })
		await hook.state().exportPolicy()
	})
	expect(hook.state().exported).toBeUndefined()
	expect(hook.state().error).toContain('Loading current allocation policy…')
	expect(hook.state().policyExportReason).toBe('Loading current allocation policy…')
	await act(async () => {
		loadingPolicy.resolve({ ...observedPolicy, config: { ...observedPolicy.config, executor: zeroAddress }, version: 0n, nonce: 0n })
	})
	await waitFor(() => expect(hook.state().policy?.version).toBe(0n))
	await act(async () => {
		await hook.state().exportPolicy()
	})
	expect(hook.state().exported).toContain(vault)
})

test('retries a failed policy read after a same-block snapshot refresh without clearing form results', async () => {
	let failing = true
	const hook = await renderActions(
		async () => latestBlock,
		undefined,
		async () => {
			if (failing) throw new Error('Temporary allocation policy read failure')
			return observedPolicy
		},
	)
	await preparePolicy(hook)
	await waitFor(() => expect(hook.state().policyReadError).toContain('Temporary allocation policy read failure'))
	expect(hook.state().policy).toBeUndefined()
	expect(hook.state().policyExportReason).toContain('Temporary allocation policy read failure')
	await act(async () => {
		await hook.state().exportCreate()
	})
	const exported = hook.state().exported
	expect(exported).toBeDefined()
	failing = false
	await hook.setProps({ model: { ...selectedModel, snapshot: structuredClone(selectedModel.snapshot) } })
	await waitFor(() => expect(hook.state().policy?.version).toBe(observedPolicy.version))
	expect(hook.state().policyReadError).toBeUndefined()
	expect(hook.state().policyExportReason).toBeUndefined()
	expect(hook.state().drafts['5']?.deposit).toBe('100')
	expect(hook.state().executor).toBe(owner)
	expect(hook.state().depositBudget).toBe('200')
	expect(hook.state().exported).toBe(exported)
	await act(async () => {
		await hook.state().exportPolicy()
	})
	expect(hook.state().exported).toContain(vault)
	expect(hook.state().error).toBeUndefined()
})

test('ignores an earlier policy read failure after a same-block snapshot retry succeeds', async () => {
	const earlierRead = createDeferred<Policy>()
	let retrying = false
	const hook = await renderActions(undefined, undefined, async () => (retrying ? observedPolicy : earlierRead.promise))
	await preparePolicy(hook)
	expect(hook.state().policy).toBeUndefined()
	retrying = true
	await hook.setProps({ model: { ...selectedModel, snapshot: structuredClone(selectedModel.snapshot) } })
	await waitFor(() => expect(hook.state().policy?.version).toBe(observedPolicy.version))
	await act(async () => {
		earlierRead.reject(new Error('Obsolete allocation policy read failure'))
	})
	expect(hook.state().policy?.version).toBe(observedPolicy.version)
	expect(hook.state().policyReadError).toBeUndefined()
	expect(hook.state().policyExportReason).toBeUndefined()
})

test('retains form results during a same-portfolio refresh with transiently absent selection', async () => {
	const hook = await renderActions()
	const exported = hook.state().exported
	expect(exported).toBeDefined()
	await hook.setProps({ model: { ...selectedModel, selection: undefined, loading: true } })
	await hook.setProps({ model: selectedModel })
	expect(hook.state().drafts['5']?.deposit).toBe('100')
	expect(hook.state().exported).toBe(exported)
})

test('clears form results when the selected owner, manager, universe or backend changes', async () => {
	for (const change of ['owner', 'manager', 'universe', 'backend', 'position page']) {
		const hook = await renderActions()
		if (change === 'backend') installActiveEnvironmentForTesting(createExportBackend())
		await hook.setProps({
			model: { ...selectedModel, snapshot: change === 'position page' && selectedModel.snapshot !== undefined ? { ...selectedModel.snapshot, questions: [300n] } : selectedModel.snapshot, ownerInput: change === 'owner' ? vault : owner, managerInput: change === 'manager' ? vault : manager },
			universe: change === 'universe' ? 1n : 0n,
		})
		expect(hook.state().drafts).toEqual({})
		expect(hook.state().exported).toBeUndefined()
		await hook.cleanup()
	}
})

test('captures wallet policy fields before an asynchronous expiry read without applying later edits', async () => {
	const block = createDeferred<unknown>()
	const readingExpiry = createDeferred<void>()
	const sent: { data?: Hex | undefined }[] = []
	const client = asWriteClient(createMockWriteClient(request => sent.push(request)))
	const hook = await renderActions(
		() => {
			readingExpiry.resolve()
			return block.promise
		},
		undefined,
		undefined,
		() => ({ ...client, account: { address: owner, type: 'json-rpc' }, chain: MAINNET_NETWORK_PROFILE.chain, call: async () => ({ data: undefined }) }),
	)
	await act(() => {
		hook.state().setExecutor(owner)
		hook.state().setExpiryHours('2')
		hook.state().setDepositBudget('200')
		hook.state().setCommitmentBudget('2')
		hook.state().setReserve('500')
		hook.state().setDraft(5n, { commitment: '3' })
	})
	const installing = hook.state().installPolicy()
	await readingExpiry.promise
	await act(() => {
		hook.state().setExecutor(vault)
		hook.state().setExpiryHours('8')
		hook.state().setDepositBudget('900')
		hook.state().setCommitmentBudget('9')
		hook.state().setReserve('0')
		hook.state().setHealth('15000')
		hook.state().setDraft(5n, { deposit: '900', commitment: '9' })
	})
	await act(async () => {
		block.resolve(latestBlock)
		await installing
	})
	expect(hook.state().error).toBeUndefined()
	expect(sent).toHaveLength(1)
	const data = sent[0]?.data
	if (data === undefined) throw new Error('Expected a wallet policy transaction')
	const decoded = decodeFunctionData({ abi: vaultArtifact.abi, data })
	if (decoded.functionName !== 'setAllocationPolicy') throw new Error('Expected policy calldata')
	expect(decoded.args?.[0]).toBe(7n)
	expect(decoded.args?.[1]).toBe(2n)
	expect(decoded.args?.[2]).toEqual({ universeId: 0n, executor: owner, expiresAt: 8200n, depositBudgetAttoRep: 200n * 10n ** 18n, commitmentIncreaseBudgetAttoEth: 2n * 10n ** 18n, minimumIdleAttoRep: 500n * 10n ** 18n, minimumHealthFactorBps: 12000n })
	expect(decoded.args?.[3]).toEqual([{ questionId: 5n, depositBudgetAttoRep: 100n * 10n ** 18n, maximumCommitmentAttoEth: 3n * 10n ** 18n }])
})

for (const changedCounter of ['version', 'nonce'] as const) {
	test(`rejects a policy export when the reviewed ${changedCounter} changes during the expiry read`, async () => {
		const block = createDeferred<unknown>()
		let latestPolicy = structuredClone(observedPolicy)
		const hook = await renderActions(
			() => block.promise,
			undefined,
			async () => latestPolicy,
		)
		await preparePolicy(hook)
		await act(() => hook.state().setDraft(5n, { deposit: '100' }))
		const exporting = hook.state().exportPolicy()
		latestPolicy = { ...latestPolicy, [changedCounter]: latestPolicy[changedCounter] + 1n }
		await act(async () => {
			block.resolve(latestBlock)
			await exporting
		})
		expect(hook.state().exported).toBeUndefined()
		expect(hook.state().error).toContain('Allocation authority changed. Refresh and review the policy again.')
	})
}

for (const change of ['owner', 'manager', 'universe']) {
	test(`discards an in-flight policy export after the selected ${change} changes`, async () => {
		const block = createDeferred<unknown>()
		const hook = await renderActions(() => block.promise)
		await preparePolicy(hook)
		const exporting = hook.state().exportPolicy()
		await hook.setProps({ model: { ...selectedModel, selection: undefined, ownerInput: change === 'owner' ? vault : owner, managerInput: change === 'manager' ? vault : manager }, universe: change === 'universe' ? 1n : 0n })
		await act(async () => {
			block.resolve(latestBlock)
			await exporting
		})
		expect(hook.state().exported).toBeUndefined()
		expect(hook.state().error).toBeUndefined()
	})
}

test('discards an in-flight policy export when the backend changes before a rerender', async () => {
	const block = createDeferred<unknown>()
	const hook = await renderActions(() => block.promise)
	await preparePolicy(hook)
	const exporting = hook.state().exportPolicy()
	const readNewChainId = mock(async () => 11155111)
	installActiveEnvironmentForTesting(createExportBackend(undefined, readNewChainId))
	await act(async () => {
		block.resolve(latestBlock)
		await exporting
	})
	expect(readNewChainId).not.toHaveBeenCalled()
	await hook.setProps({})
	expect(hook.state().exported).toBeUndefined()
	await act(async () => {
		await hook.state().exportCreate()
	})
	expect(JSON.parse(hook.state().exported ?? '{}')).toMatchObject({ chainId: 11155111, to: manager })
})

test('discards an in-flight create export after its context changes during the chain ID read', async () => {
	const chainId = createDeferred<number>()
	const readingChainId = createDeferred<void>()
	let deferChainId = false
	const hook = await renderActions(undefined, async () => {
		if (!deferChainId) return 1
		readingChainId.resolve()
		return await chainId.promise
	})
	deferChainId = true
	const exporting = hook.state().exportCreate()
	await readingChainId.promise
	await hook.setProps({ universe: 1n })
	await act(async () => {
		chainId.resolve(1)
		await exporting
	})
	expect(hook.state().exported).toBeUndefined()
})

test('keeps a newer create export when an earlier policy export finishes later', async () => {
	const block = createDeferred<unknown>()
	const hook = await renderActions(() => block.promise)
	await preparePolicy(hook)
	const exporting = hook.state().exportPolicy()
	await act(async () => {
		await hook.state().exportCreate()
	})
	const latestExport = hook.state().exported
	expect(latestExport).toBeDefined()
	await act(async () => {
		block.resolve(latestBlock)
		await exporting
	})
	expect(hook.state().exported).toBe(latestExport)
})

test('discards an earlier export failure after a newer export succeeds', async () => {
	const block = createDeferred<unknown>()
	const hook = await renderActions(() => block.promise)
	await preparePolicy(hook)
	const exporting = hook.state().exportPolicy()
	await act(async () => {
		await hook.state().exportCreate()
		block.reject(new Error('Old block read failed'))
		await exporting
	})
	expect(hook.state().error).toBeUndefined()
})

test('allows an in-flight export to finish across a transient same-portfolio refresh', async () => {
	const block = createDeferred<unknown>()
	const hook = await renderActions(() => block.promise)
	await preparePolicy(hook)
	const exporting = hook.state().exportPolicy()
	await hook.setProps({ model: { ...selectedModel, selection: undefined, loading: true } })
	await hook.setProps({ model: selectedModel })
	await act(async () => {
		block.resolve(latestBlock)
		await exporting
	})
	expect(hook.state().exported).toContain(vault)
	expect(hook.state().error).toBeUndefined()
})

for (const failRegistration of [false, true]) {
	test(`deploys with one transaction and registers its seed only on a separate click, retaining it on failure (${failRegistration})`, async () => {
		const sent: { to?: `0x${string}` | null | undefined; data?: Hex | undefined }[] = []
		let failing = failRegistration
		const mockClient = createMockWriteClient(request => {
			sent.push(request)
			if (request.to === manager && failing) throw new Error('Registration rejected by wallet')
		})
		mockClient.waitForTransactionReceipt = async () => ({ status: 'success', contractAddress: sent.length === 1 ? manager : null })
		const client = asWriteClient(mockClient)
		const hook = await renderActions(undefined, undefined, undefined, () => {
			let planned = false
			return {
				...client,
				account: { address: owner, type: 'json-rpc' },
				chain: MAINNET_NETWORK_PROFILE.chain,
				call: async () => ({ data: undefined }),
				onTransactionPlan: () => {
					if (planned) throw new Error('Cannot change a transaction plan after it has started.')
					planned = true
				},
			}
		})
		const load = mock(async () => undefined)
		await hook.setProps({ model: { ...selectedModel, load } })
		await act(async () => {
			hook.state().setOriginInput(vault)
			await hook.state().deploy()
		})
		expect(load).toHaveBeenCalledWith(manager, owner)
		expect(sent).toHaveLength(1)
		expect(sent[0]?.to).toBeUndefined()
		expect(hook.state().questionInput).toBe('5')
		expect(hook.state().error).toBeUndefined()
		await act(async () => {
			await hook.state().register()
		})
		expect(sent).toHaveLength(2)
		const registration = sent[1]
		if (registration?.data === undefined) throw new Error('Missing registration')
		expect(registration.to).toBe(manager)
		expect(decodeFunctionData({ abi: parseAbi(['function addQuestion(uint256 questionId)']), data: registration.data }).args).toEqual([5n])
		expect(hook.state().questionInput).toBe('5')
		if (failRegistration) {
			expect(hook.state().error).toContain('Registration rejected by wallet')
			failing = false
			await act(async () => {
				await hook.state().register()
			})
			expect(sent).toHaveLength(3)
			expect(sent[2]?.to).toBe(manager)
		} else expect(hook.state().error).toBeUndefined()
	})
}

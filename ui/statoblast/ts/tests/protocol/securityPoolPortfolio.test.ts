import { expect, mock, test } from 'bun:test'
import { createPublicClient, custom, decodeFunctionData, encodeEventTopics, getAddress, isHex, parseAbi, zeroAddress, zeroHash, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { asWriteClient, createMockWriteClient, createMockReadClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getInfraContractAddresses, getSecurityPoolPortfolioRuntimeCode, getSecurityPoolPortfolioQuoteRuntimeCode, getSecurityPoolPortfolioRecoveryRuntimeCode, getSecurityPoolPortfolioVaultRuntimeCode, getSecurityPoolPortfolioVaultDeployerRuntimeCode } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { portfolioContractRequest, sendPortfolioTransaction, vaultArtifact, loadPortfolioOwnerVault, discoverSimulationPortfolio, capturePortfolioBatchReview, portfolioPolicyReviewRequest, type loadPortfolioPolicy } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import type { TransactionPlanStep, TransactionRequestPreview } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { planPortfolioAllocations, type PortfolioSnapshot, type PortfolioPosition } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

const deployer = getInfraContractAddresses().securityPoolPortfolioVaultDeployer
const quoteHelper = getAddress('0x00000000000000000000000000000000000000e1')
const recoveryLedger = getAddress('0x00000000000000000000000000000000000000e2')
const owner = getAddress('0x0000000000000000000000000000000000000011')
const vault = getAddress('0x0000000000000000000000000000000000000022')
type Policy = Awaited<ReturnType<typeof loadPortfolioPolicy>>

function fixtureRuntime(address: Address, vaultRuntime = getSecurityPoolPortfolioVaultRuntimeCode()) {
	if (address === quoteHelper) return getSecurityPoolPortfolioQuoteRuntimeCode()
	if (address === recoveryLedger) return getSecurityPoolPortfolioRecoveryRuntimeCode()
	if (address === deployer) return getSecurityPoolPortfolioVaultDeployerRuntimeCode()
	if (address === owner) return getSecurityPoolPortfolioRuntimeCode()
	return vaultRuntime
}

function policyReadClient(readPolicy: () => Policy) {
	return createPublicClient({
		transport: custom({
			request: async ({ method }) => {
				if (method === 'eth_getBlockByNumber') return { timestamp: '0x3e8', gasLimit: '0x0', gasUsed: '0x0', difficulty: '0x0', number: '0x2', hash: zeroHash, transactions: [] }
				throw new Error(`Unexpected RPC call: ${method}`)
			},
		}),
	}).extend(() =>
		createMockReadClient(async request => {
			if (request.functionName === 'vaultDeployer') return deployer
			const policy = readPolicy()
			expect(request.blockNumber).toBe(2n)
			if (request.functionName === 'allocationPolicy') return [policy.config, policy.repToken, policy.spentDepositAttoRep, policy.spentCommitmentIncreaseAttoEth]
			if (request.functionName === 'allocationPolicyVersion') return policy.version
			if (request.functionName === 'allocationPolicyNonce') return policy.nonce
			throw new Error(`Unexpected policy read: ${request.functionName}`)
		}),
	)
}

function mockClient() {
	const send = mock(() => undefined)
	const validateCall = mock(async () => ({ data: undefined }))
	const client = { ...asWriteClient(createMockWriteClient(send)), account: { address: owner, type: 'json-rpc' } as const, chain: MAINNET_NETWORK_PROFILE.chain, call: validateCall }
	return { send, validateCall, client }
}

test('requires the actual smart owner as sender and never impersonates it with a connected EOA', async () => {
	const { client, send, validateCall } = mockClient()
	const request = portfolioContractRequest(vault, vault, 'revokeAllocationPolicy', [], true)
	await expect(sendPortfolioTransaction(client, request, 'Revoke policy')).rejects.toThrow('Connect the transaction owner account')
	expect(send).not.toHaveBeenCalled()
	expect(validateCall).not.toHaveBeenCalled()
})

test('revalidates and sends exactly one named vault transaction', async () => {
	const { client, send, validateCall } = mockClient()
	const validate = mock(async () => undefined)
	const request = portfolioContractRequest(owner, vault, 'revokeAllocationPolicy', [], true)
	expect(decodeFunctionData({ abi: vaultArtifact.abi, data: request.data }).functionName).toBe('revokeAllocationPolicy')
	await sendPortfolioTransaction(client, request, 'Revoke policy', validate)
	expect(validate).toHaveBeenCalledTimes(1)
	expect(validateCall).toHaveBeenCalledTimes(1)
	expect(send).toHaveBeenCalledTimes(1)
})

test('presents the readable review description in the exact planned and prepared transaction', async () => {
	const { client } = mockClient()
	const onTransactionPlan = mock((_steps: readonly TransactionPlanStep[]) => undefined)
	const onTransactionPrepared = mock((_preview: TransactionRequestPreview) => undefined)
	const request = { ...portfolioContractRequest(owner, vault, 'revokeAllocationPolicy', [], true), reviewDescription: 'Revoke delegated allocation authority for this vault.' }
	await sendPortfolioTransaction({ ...client, onTransactionPlan, onTransactionPrepared }, request, 'Revoke policy')
	expect(onTransactionPlan.mock.calls[0]?.[0][0]?.reviewDescription).toBe(request.reviewDescription)
	expect(onTransactionPrepared.mock.calls[0]?.[0].reviewDescription).toBe(request.reviewDescription)
})

test('captures the request before asynchronous validation so later mutations cannot alter the transaction', async () => {
	const { client, send } = mockClient()
	const request = portfolioContractRequest(owner, vault, 'revokeAllocationPolicy', [], true)
	const original = { ...request }
	await sendPortfolioTransaction(client, request, 'Revoke policy', async () => {
		request.to = owner
		request.data = '0x1234'
	})
	expect(send).toHaveBeenCalledWith({ to: original.to, data: original.data, value: original.value })
})

function reviewSnapshot(): PortfolioSnapshot {
	const position: PortfolioPosition = {
		questionId: 5n,
		universeId: 0n,
		pool: vault,
		registered: true,
		repToken: owner,
		coordinator: vault,
		priceFeed: vault,
		pendingReportCoordinator: vault,
		backingUnits: 0n,
		backingAttoRep: 0n,
		commitmentAttoEth: 0n,
		claimableFeesAttoEth: 0n,
		openInterestAttoEth: 0n,
		badDebtAttoEth: 0n,
		disputeStakeAttoRep: 0n,
		ordinaryResidualPending: false,
		poolHeldAttoRep: 0n,
		totalBackingUnits: 0n,
		poolCommitmentAttoEth: 0n,
		settlementCollateralAttoEth: 0n,
		securityMultiplierBps: 20000n,
		minimumDepositAttoRep: 1n,
		systemState: 0n,
		resolved: false,
		questionEndTime: 1000n,
		forkTime: 0n,
		price: 10n ** 18n,
		priceValid: true,
		pendingReportId: 0n,
		settlementTime: 60n,
		queuedOperations: [],
		queuedOperationsComplete: true,
		allocationOperationsComplete: true,
	}
	return {
		chainId: 1,
		blockNumber: 1n,
		blockHash: zeroHash,
		timestamp: 100n,
		portfolio: owner,
		vault,
		owner,
		originUniverseId: 0n,
		questions: [5n, 6n],
		coverage: { complete: true, registryComplete: true, issues: [], scope: 'registered-and-explicit-pools' },
		branches: [{ universeId: 0n, repToken: owner, idleAttoRep: 3000n * 10n ** 18n, forkTime: 0n, positions: [position, { ...position, questionId: 6n, pool: owner }] }],
	}
}

test('allocation review binds readable question amounts and limits to calldata and rejects stale results', () => {
	const snapshot = reviewSnapshot()
	const plan = planPortfolioAllocations({
		snapshot,
		universeId: 0n,
		minimumIdleAttoRep: 500n * 10n ** 18n,
		minimumHealthFactorBps: 12000n,
		allocations: [
			{ questionId: 5n, depositAttoRep: 100n * 10n ** 18n, commitmentAttoEth: 2n * 10n ** 18n },
			{ questionId: 6n, depositAttoRep: 200n * 10n ** 18n, commitmentAttoEth: 3n * 10n ** 18n },
		],
	})
	const reviewed = capturePortfolioBatchReview(owner, vault, snapshot, plan)
	for (const text of ['Universe 0', `Question 0x5; pool ${vault}: deposit 100 REP; target commitment 2 ETH`, `Question 0x6; pool ${owner}: deposit 200 REP; target commitment 3 ETH`, '120% (12000 bps)', 'at least 500 REP idle', 'idle after allocation: 2700 REP'])
		expect(reviewed.request.reviewDescription).toContain(text)
	const encoded = reviewed.request.data
	const first = plan.operations[0]
	if (first === undefined) throw new Error('Expected a planned allocation')
	first.input.depositAttoRep = 900n * 10n ** 18n
	plan.idleAfterAttoRep = 0n
	expect(reviewed.request.data).toBe(encoded)
	expect(reviewed.request.reviewDescription).toContain('deposit 100 REP')
	expect(() => reviewed.validateSnapshot(reviewSnapshot())).not.toThrow()
	const stale = reviewSnapshot()
	const branch = stale.branches[0]
	if (branch === undefined) throw new Error('Expected a portfolio branch')
	branch.idleAttoRep -= 1n
	expect(() => reviewed.validateSnapshot(stale)).toThrow('Refresh and review the allocation again')
	branch.idleAttoRep += 1n
	const position = branch.positions[0]
	if (position === undefined) throw new Error('Expected a question position')
	position.priceValid = false
	expect(() => reviewed.validateSnapshot(stale)).toThrow('settled, fresh oracle price')
})

test('policy review describes exact spending authority and keeps encoded limits after input mutation', () => {
	const config = { universeId: 4n, executor: owner, expiresAt: 2000000000n, depositBudgetAttoRep: 200n * 10n ** 18n, commitmentIncreaseBudgetAttoEth: 2n * 10n ** 18n, minimumIdleAttoRep: 500n * 10n ** 18n, minimumHealthFactorBps: 12000n }
	const rules = [{ questionId: 5n, depositBudgetAttoRep: 100n * 10n ** 18n, maximumCommitmentAttoEth: 3n * 10n ** 18n }]
	const previousPolicy: Policy = { config, version: 7n, nonce: 2n, repToken: vault, spentDepositAttoRep: 25n * 10n ** 18n, spentCommitmentIncreaseAttoEth: 10n ** 18n }
	const request = portfolioPolicyReviewRequest({ owner, vault, previousPolicy, config, rules, client: policyReadClient(() => previousPolicy) })
	for (const text of [
		'Reviewed prior policy version 7, nonce 2',
		'Prior spending: 25 of 200 REP deposits; 1 of 2 ETH commitment increases',
		`Executor ${owner}`,
		'universe 4',
		'2033-05-18T03:33:20.000Z',
		'200 REP deposits',
		'2 ETH commitment increases',
		'Question 0x5: deposit budget 100 REP; commitment cap 3 ETH',
		'120% (12000 bps)',
		'at least 500 REP idle',
		'Replacing a policy grants fresh budgets; prior spending is not deducted',
		'Manual vault execution revokes this policy. Transferring REP into the vault leaves the policy active',
	])
		expect(request.reviewDescription).toContain(text)
	const encoded = request.data
	config.depositBudgetAttoRep = 900n
	rules.splice(0)
	expect(request.data).toBe(encoded)
	const decoded = decodeFunctionData({ abi: vaultArtifact.abi, data: request.data })
	expect(decoded.functionName).toBe('setAllocationPolicy')
	if (decoded.functionName !== 'setAllocationPolicy') throw new Error('Expected policy calldata')
	expect(decoded.args?.[0]).toBe(7n)
	expect(decoded.args?.[1]).toBe(2n)
	expect(decoded.args?.[2].depositBudgetAttoRep).toBe(200n * 10n ** 18n)
})

for (const changedCounter of ['version', 'nonce'] as const) {
	test(`rejects changed policy ${changedCounter} when the captured review is confirmed`, async () => {
		const config = { universeId: 4n, executor: owner, expiresAt: 2000000000n, depositBudgetAttoRep: 200n * 10n ** 18n, commitmentIncreaseBudgetAttoEth: 0n, minimumIdleAttoRep: 0n, minimumHealthFactorBps: 12000n }
		const previousPolicy: Policy = { config, version: 7n, nonce: 2n, repToken: vault, spentDepositAttoRep: 0n, spentCommitmentIncreaseAttoEth: 0n }
		const readClient = policyReadClient(() => previousPolicy)
		const request = portfolioPolicyReviewRequest({ owner, vault, previousPolicy, config, rules: [{ questionId: 5n, depositBudgetAttoRep: 100n * 10n ** 18n, maximumCommitmentAttoEth: 0n }], client: readClient })
		const { client, send } = mockClient()
		let review: TransactionPlanStep | undefined
		await expect(
			sendPortfolioTransaction(
				{
					...client,
					onTransactionPlan: steps => {
						review = steps[0]
					},
					sendTransaction: async parameters => {
						previousPolicy[changedCounter] += 1n
						if (review?.validateBeforeSubmit === undefined) throw new Error('Expected policy confirmation validation')
						await review.validateBeforeSubmit()
						return await client.sendTransaction(parameters)
					},
				},
				request,
				'Install policy',
			),
		).rejects.toThrow('Allocation authority changed. Refresh and review the policy again.')
		expect(send).not.toHaveBeenCalled()
		const decoded = decodeFunctionData({ abi: vaultArtifact.abi, data: request.data })
		if (decoded.functionName !== 'setAllocationPolicy') throw new Error('Expected policy calldata')
		expect(decoded.args?.[0]).toBe(7n)
		expect(decoded.args?.[1]).toBe(2n)
	})
}

test('rejects an imported manager that spoofs vault ownership with different runtime code', async () => {
	const client = { ...createMockReadClient(async request => (request.functionName === 'vaultOf' ? vault : 0n)), getCode: async () => '0x00' as const }
	await expect(loadPortfolioOwnerVault(client, vault, owner)).rejects.toThrow('Unrecognized portfolio runtime code')
})

test('rejects the expected manager bytecode when its immutable factory is not the configured factory', async () => {
	const client = {
		...createMockReadClient(async request => {
			if (request.functionName === 'quoteHelper') return quoteHelper
			if (request.functionName === 'recoveryLedger') return recoveryLedger
			if (request.functionName === 'vaultDeployer') return deployer
			if (request.functionName === 'vaultOf') return vault
			if (request.functionName === 'factory') return owner
			return 0n
		}),
		getCode: async () => getSecurityPoolPortfolioRuntimeCode(),
	}
	await expect(loadPortfolioOwnerVault(client, vault, owner)).rejects.toThrow('unrecognized pool factory')
})

test.each(['missing', 'wrong'] as const)('rejects an imported manager with %s quote helper runtime', async fault => {
	const client = {
		...createMockReadClient(async request => {
			if (request.functionName === 'quoteHelper') return quoteHelper
			if (request.functionName === 'recoveryLedger') return recoveryLedger
			if (request.functionName === 'vaultDeployer') return deployer
			if (request.functionName === 'vaultOf') return zeroAddress
			if (request.functionName === 'originUniverseId') return 0n
			if (request.functionName === 'factory') return getInfraContractAddresses().securityPoolFactory
			if (request.functionName === 'portfolio') return owner
			throw new Error('Unexpected portfolio read')
		}),
		getCode: async ({ address }: { address: Address }) => {
			if (address !== quoteHelper) return fixtureRuntime(address)
			if (fault === 'missing') return undefined
			const expected = getSecurityPoolPortfolioQuoteRuntimeCode()
			const malicious = `0x${expected.slice(2, 4) === '00' ? '01' : '00'}${expected.slice(4)}`
			if (!isHex(malicious)) throw new Error('Expected hexadecimal helper runtime')
			return malicious
		},
	}
	await expect(loadPortfolioOwnerVault(client, owner, owner)).rejects.toThrow('Unrecognized portfolio quote helper runtime code')
})

for (const fault of ['runtime', 'canonical address'] as const) {
	test(`rejects an imported manager with a vault deployer ${fault} mismatch`, async () => {
		const client = {
			...createMockReadClient(async request => {
				if (request.functionName === 'quoteHelper') return quoteHelper
				if (request.functionName === 'recoveryLedger') return recoveryLedger
				if (request.functionName === 'vaultDeployer') return fault === 'canonical address' ? vault : deployer
				if (request.functionName === 'vaultOf') return zeroAddress
				if (request.functionName === 'originUniverseId') return 0n
				if (request.functionName === 'factory') return getInfraContractAddresses().securityPoolFactory
				if (request.functionName === 'portfolio') return owner
				throw new Error('Unexpected portfolio read')
			}),
			getCode: async ({ address }: { address: Address }) => {
				if (address === quoteHelper) return getSecurityPoolPortfolioQuoteRuntimeCode()
				if (address === recoveryLedger) return getSecurityPoolPortfolioRecoveryRuntimeCode()
				if (address === owner) return getSecurityPoolPortfolioRuntimeCode()
				return fault === 'runtime' ? '0x00' : getSecurityPoolPortfolioVaultDeployerRuntimeCode()
			},
		}
		await expect(loadPortfolioOwnerVault(client, owner, owner)).rejects.toThrow(fault === 'runtime' ? 'Unrecognized portfolio vault deployer runtime code' : 'Portfolio uses an unrecognized vault deployer')
	})
}

test('rejects spoofed vault code and owner claims after verifying the manager', async () => {
	const readContract = createMockReadClient(async request => {
		if (request.functionName === 'quoteHelper') return quoteHelper
		if (request.functionName === 'recoveryLedger') return recoveryLedger
		if (request.functionName === 'vaultDeployer') return deployer
		if (request.functionName === 'vaultOf') return vault
		if (request.functionName === 'predictVaultAddress') return vault
		if (request.functionName === 'originUniverseId') return 0n
		if (request.functionName === 'factory') return getInfraContractAddresses().securityPoolFactory
		if (request.functionName === 'portfolio') return owner
		if (request.functionName === 'owner') return vault
		throw new Error('Unexpected portfolio read')
	})
	await expect(loadPortfolioOwnerVault({ ...readContract, getCode: async ({ address }) => fixtureRuntime(address, '0x00') }, owner, owner)).rejects.toThrow('Unrecognized portfolio vault runtime code')
	await expect(loadPortfolioOwnerVault({ ...readContract, getCode: async ({ address }) => fixtureRuntime(address) }, owner, owner)).rejects.toThrow('ownership does not match')
})

test('rejects a vault with inconsistent repeated immutable values even when getters claim the selected owner', async () => {
	const references = Object.values(vaultArtifact.evm.deployedBytecode.immutableReferences).find(entries => entries.length >= 2)
	const first = references?.[0]
	const second = references?.[1]
	if (first === undefined || second === undefined) throw new Error('Expected repeated vault immutable references')
	const runtime = getSecurityPoolPortfolioVaultRuntimeCode()
	const patch = (code: string, reference: { start: number; length: number }, value: string) => code.slice(0, 2 + reference.start * 2) + value.padStart(reference.length * 2, '0') + code.slice(2 + (reference.start + reference.length) * 2)
	const malicious = patch(patch(runtime, first, '11'), second, '22')
	if (!isHex(malicious)) throw new Error('Expected hexadecimal malicious runtime')
	const client = {
		...createMockReadClient(async request => {
			if (request.functionName === 'quoteHelper') return quoteHelper
			if (request.functionName === 'recoveryLedger') return recoveryLedger
			if (request.functionName === 'vaultDeployer') return deployer
			if (request.functionName === 'vaultOf') return vault
			if (request.functionName === 'predictVaultAddress') return vault
			if (request.functionName === 'originUniverseId') return 0n
			if (request.functionName === 'factory') return getInfraContractAddresses().securityPoolFactory
			if (request.functionName === 'portfolio' || request.functionName === 'owner') return owner
			throw new Error('Unexpected portfolio read')
		}),
		getCode: async ({ address }: { address: Address }) => fixtureRuntime(address, malicious),
	}
	await expect(loadPortfolioOwnerVault(client, owner, owner)).rejects.toThrow('Inconsistent portfolio vault immutable')
})

test('rejects a vault clone at a noncanonical address despite matching code and owner getters', async () => {
	const client = {
		...createMockReadClient(async request => {
			if (request.functionName === 'quoteHelper') return quoteHelper
			if (request.functionName === 'recoveryLedger') return recoveryLedger
			if (request.functionName === 'vaultDeployer') return deployer
			if (request.functionName === 'vaultOf') return vault
			if (request.functionName === 'predictVaultAddress') return owner
			if (request.functionName === 'originUniverseId') return 0n
			if (request.functionName === 'factory') return getInfraContractAddresses().securityPoolFactory
			if (request.functionName === 'portfolio' || request.functionName === 'owner') return owner
			throw new Error('Unexpected portfolio read')
		}),
		getCode: async ({ address }: { address: Address }) => fixtureRuntime(address),
	}
	await expect(loadPortfolioOwnerVault(client, owner, owner)).rejects.toThrow('canonical owner vault address')
})

function vaultCreatedLog(manager: Address, eventOwner: Address, eventVault = vault) {
	const abi = parseAbi(['event VaultCreated(address indexed owner,address indexed vault)'])
	const topics = encodeEventTopics({ abi, eventName: 'VaultCreated', args: { owner: eventOwner, vault: eventVault } })
	if (!topics.every((topic): topic is Hex => typeof topic === 'string')) throw new Error('Expected concrete vault creation topics')
	return { address: manager, data: '0x' as const, topics }
}

test('discovers the simulation portfolio on the main thread and verifies spoofed emitters before loading', async () => {
	const manager = getAddress('0x0000000000000000000000000000000000000033')
	const spoof = getAddress('0x0000000000000000000000000000000000000044')
	const queried: { fromBlock: bigint; args: { owner: Address } }[] = []
	const getCode = mock(async ({ address }: { address: Address }) => {
		if (address === quoteHelper) return getSecurityPoolPortfolioQuoteRuntimeCode()
		if (address === recoveryLedger) return getSecurityPoolPortfolioRecoveryRuntimeCode()
		if (address === deployer) return getSecurityPoolPortfolioVaultDeployerRuntimeCode()
		if (address === manager) return getSecurityPoolPortfolioRuntimeCode()
		if (address === vault) return getSecurityPoolPortfolioVaultRuntimeCode()
		return '0x00' as const
	})
	const client = {
		...createMockReadClient(async request => {
			if (request.functionName === 'quoteHelper') return quoteHelper
			if (request.functionName === 'recoveryLedger') return recoveryLedger
			if (request.functionName === 'vaultDeployer') return deployer
			if (request.functionName === 'vaultOf' || request.functionName === 'predictVaultAddress') return vault
			if (request.functionName === 'originUniverseId') return 0n
			if (request.functionName === 'factory') return getInfraContractAddresses().securityPoolFactory
			if (request.functionName === 'portfolio') return manager
			if (request.functionName === 'owner') return owner
			throw new Error('Unexpected portfolio read')
		}),
		getCode,
		getLogs: async (parameters: { fromBlock: bigint; args: { owner: Address } }) => {
			queried.push(parameters)
			return [vaultCreatedLog(manager, owner), vaultCreatedLog(spoof, owner)]
		},
	}
	expect(await discoverSimulationPortfolio(client, 'simulation', owner)).toBe(manager)
	expect(queried).toHaveLength(1)
	expect(queried[0]?.args.owner).toBe(owner)
	expect(queried[0]?.fromBlock).toBe(0n)
	expect(getCode).toHaveBeenCalledWith({ address: spoof })
	expect(getCode).toHaveBeenCalledWith({ address: vault })
	expect(getCode).toHaveBeenCalledWith({ address: quoteHelper })
})

test('does not perform global portfolio log scans on production backends', async () => {
	const getLogs = mock(async () => [])
	const client = {
		...createMockReadClient(async () => {
			throw new Error('Unexpected read')
		}),
		getLogs,
		getCode: async () => '0x00' as const,
	}
	expect(await discoverSimulationPortfolio(client, 'injected', owner)).toBeUndefined()
	expect(getLogs).not.toHaveBeenCalled()
})

test.each(['missing', 'runtime', 'binding'] as const)('rejects an imported manager with a recovery ledger %s mismatch', async fault => {
	const client = {
		...createMockReadClient(async request => {
			if (request.functionName === 'quoteHelper') return quoteHelper
			if (request.functionName === 'recoveryLedger') return recoveryLedger
			if (request.functionName === 'vaultDeployer') return deployer
			if (request.functionName === 'vaultOf') return zeroAddress
			if (request.functionName === 'originUniverseId') return 0n
			if (request.functionName === 'factory') return getInfraContractAddresses().securityPoolFactory
			if (request.functionName === 'portfolio') return fault === 'binding' ? vault : owner
			throw new Error('Unexpected recovery authentication read')
		}),
		getCode: async ({ address }: { address: Address }) => {
			if (address !== recoveryLedger || fault === 'binding') return fixtureRuntime(address)
			return fault === 'missing' ? undefined : '0x00'
		},
	}
	await expect(loadPortfolioOwnerVault(client, owner, owner)).rejects.toThrow(fault === 'binding' ? 'Recovery ledger belongs to another portfolio' : 'Unrecognized portfolio recovery ledger runtime code')
})

import { decodeEventLog, encodeFunctionData, formatEther, formatUnits, getAddress, parseAbiItem, zeroAddress, type Address, type Hex, type TransactionLog } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioDeploymentRequest,
	buildPortfolioQuestionBatchRequest,
	buildPortfolioAllocationPolicyRequest,
	planPortfolioAllocations,
	type PortfolioReadClient,
	type PortfolioSnapshot,
	type PortfolioAllocationPolicyConfig,
	type PortfolioAllocationRule,
} from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/transactions/transactionReceipt.js'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact, statoblast_SecurityPoolPortfolioVaultDeployer_SecurityPoolPortfolioVaultDeployer as deployerArtifact } from '../contractArtifact.js'
import { getInfraContractAddresses, getSecurityPoolPortfolioByteCode, getSecurityPoolPortfolioRuntimeCode, getSecurityPoolPortfolioQuoteRuntimeCode, getSecurityPoolPortfolioVaultRuntimeCode, getSecurityPoolPortfolioVaultDeployerRuntimeCode } from './deploymentHelpers.js'

export { vaultArtifact }

export type PortfolioTransaction = { account: Address; to?: Address; data: Hex; value?: bigint; reviewDescription?: string; validateBeforeSubmit?: () => Promise<void> }

function verifyRuntimeCode(actual: Hex | undefined, expected: Hex, references: Readonly<Record<string, readonly { start: number; length: number }[]>>, label: string) {
	if (actual === undefined || actual.length !== expected.length) throw new Error(`Unrecognized ${label} runtime code.`)
	for (const entries of Object.values(references)) {
		let immutableValue: string | undefined
		for (const entry of entries) {
			const value = actual.slice(2 + entry.start * 2, 2 + (entry.start + entry.length) * 2).toLowerCase()
			if (immutableValue !== undefined && immutableValue !== value) throw new Error(`Inconsistent ${label} immutable values.`)
			immutableValue = value
		}
	}
	const mask = (code: string) => {
		let masked = code.toLowerCase()
		for (const entry of Object.values(references).flat()) {
			const start = 2 + entry.start * 2
			const length = entry.length * 2
			if (start < 2 || start + length > code.length) throw new Error('Invalid compiler immutable reference.')
			masked = masked.slice(0, start) + '0'.repeat(length) + masked.slice(start + length)
		}
		return masked
	}
	if (mask(actual) !== mask(expected)) throw new Error(`Unrecognized ${label} runtime code.`)
}

export async function loadPortfolioOwnerVault(client: Pick<ReadClient, 'getCode' | 'readContract'>, portfolio: Address, owner: Address) {
	verifyRuntimeCode(await client.getCode({ address: portfolio }), getSecurityPoolPortfolioRuntimeCode(), portfolioArtifact.evm.deployedBytecode.immutableReferences, 'portfolio')
	const [vault, originUniverseId, factory, quoteHelper] = await Promise.all([
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'vaultOf', args: [owner] }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'originUniverseId' }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'factory' }),
		client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'quoteHelper' }),
	])
	if (getAddress(factory) !== getAddress(getInfraContractAddresses().securityPoolFactory)) throw new Error('Portfolio uses an unrecognized pool factory.')
	// The stateless helper has no immutables: every linked runtime byte must match.
	verifyRuntimeCode(await client.getCode({ address: quoteHelper }), getSecurityPoolPortfolioQuoteRuntimeCode(), {}, 'portfolio quote helper')
	const deployer = await client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'vaultDeployer' })
	verifyRuntimeCode(await client.getCode({ address: deployer }), getSecurityPoolPortfolioVaultDeployerRuntimeCode(), deployerArtifact.evm.deployedBytecode.immutableReferences, 'portfolio vault deployer')
	if (getAddress(await client.readContract({ address: deployer, abi: deployerArtifact.abi, functionName: 'portfolio' })) !== getAddress(portfolio)) throw new Error('Portfolio vault deployer belongs to another portfolio.')
	if (vault !== zeroAddress) {
		const predictedVault = await client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'predictVaultAddress', args: [owner] })
		if (getAddress(vault) !== getAddress(predictedVault)) throw new Error('Portfolio did not return its canonical owner vault address.')
		verifyRuntimeCode(await client.getCode({ address: vault }), getSecurityPoolPortfolioVaultRuntimeCode(), vaultArtifact.evm.deployedBytecode.immutableReferences, 'portfolio vault')
		const [vaultOwner, vaultPortfolio] = await Promise.all([client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'owner' }), client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'portfolio' })])
		if (getAddress(vaultOwner) !== getAddress(owner) || getAddress(vaultPortfolio) !== getAddress(portfolio)) throw new Error('Portfolio vault ownership does not match the selected account.')
	}
	return { vault, originUniverseId }
}

export function portfolioCreationRequest(owner: Address, initialOriginPool: Address, maximumQuestionHorizonSeconds: bigint) {
	return buildPortfolioDeploymentRequest({ owner, initialOriginPool, maximumQuestionHorizonSeconds, factory: getInfraContractAddresses().securityPoolFactory, artifact: { abi: portfolioArtifact.abi, bytecode: getSecurityPoolPortfolioByteCode() } })
}

export function portfolioContractRequest(account: Address, to: Address, functionName: string, args: readonly unknown[] = [], vault = false): PortfolioTransaction {
	return { account, to, value: 0n, data: encodeFunctionData({ abi: vault ? vaultArtifact.abi : portfolioArtifact.abi, functionName, args }) }
}

export async function sendPortfolioTransaction(client: WriteClient, request: PortfolioTransaction, title: string, validate: () => Promise<void> = async () => undefined) {
	const captured = { ...request }
	if (getAddress(captured.account) !== getAddress(client.account.address)) throw new Error('Connect the transaction owner account.')
	const validateCaptured = async () => {
		await validate()
		await captured.validateBeforeSubmit?.()
	}
	await validateCaptured()
	await client.call({ account: client.account, to: captured.to, data: captured.data, value: captured.value })
	const review = { functionName: title, contractAddress: captured.to, data: captured.data, value: captured.value, reviewTitle: title, reviewDescription: captured.reviewDescription }
	client.onTransactionPlan?.([{ ...review, requireReview: true, validateBeforeSubmit: validateCaptured }])
	client.onTransactionPrepared?.({ ...review, args: undefined, chainName: client.chain.name, account: client.account })
	const hash = await client.sendTransaction({ to: captured.to, data: captured.data, value: captured.value })
	const result = await waitForSubmittedTransactionReceipt(client, hash)
	return { hash: result.hash, receipt: result.receipt }
}

/** Encode and describe the same captured operations; revalidation never reads mutable form inputs. */
export function capturePortfolioBatchReview(owner: Address, vault: Address, snapshot: PortfolioSnapshot, plan: ReturnType<typeof planPortfolioAllocations>) {
	const captured = structuredClone({ snapshot, plan })
	const first = captured.plan.operations[0]
	if (first === undefined) throw new Error('Choose at least one allocation.')
	const minimumIdleAttoRep = first.minimumIdleAttoRep
	const minimumHealthFactorBps = first.input.minimumReceiverHealthFactorBps
	const universeId = first.universeId
	const branch = captured.snapshot.branches.find(item => item.universeId === universeId)
	if (branch === undefined || captured.plan.operations.some(operation => operation.universeId !== universeId || operation.minimumIdleAttoRep !== minimumIdleAttoRep || operation.input.minimumReceiverHealthFactorBps !== minimumHealthFactorBps))
		throw new Error('Allocation review must use one universe, reserve and health limit.')
	const allocations = captured.plan.operations.map(operation => ({ questionId: operation.questionId, depositAttoRep: operation.input.depositAttoRep, commitmentAttoEth: operation.input.commitmentAttoEth }))
	const questionDescriptions = allocations.map(allocation => {
		const pool = branch.positions.find(position => position.questionId === allocation.questionId)?.pool
		if (pool === undefined) throw new Error('Allocation review is missing the question pool.')
		return `Question 0x${allocation.questionId.toString(16)}; pool ${pool}: deposit ${formatEther(allocation.depositAttoRep)} REP; target commitment ${formatEther(allocation.commitmentAttoEth)} ETH.`
	})
	const encoded = buildPortfolioQuestionBatchRequest({ owner, vault, vaultAbi: vaultArtifact.abi, operations: captured.plan.operations, requireImmediate: true })
	const request: PortfolioTransaction = {
		...encoded,
		reviewDescription: [
			`Universe ${universeId}.`,
			...questionDescriptions,
			`Minimum health ${formatUnits(minimumHealthFactorBps, 2)}% (${minimumHealthFactorBps} bps). Keep at least ${formatEther(minimumIdleAttoRep)} REP idle. Expected idle after allocation: ${formatEther(captured.plan.idleAfterAttoRep)} REP. All question operations must execute immediately together.`,
			'Manual vault execution revokes any active allocation policy before allocating REP.',
		].join('\n'),
	}
	const validateSnapshot = (latest: PortfolioSnapshot) => {
		if (latest.portfolio !== captured.snapshot.portfolio || latest.vault !== vault || latest.owner !== owner || latest.chainId !== captured.snapshot.chainId) throw new Error('Portfolio context changed. Refresh and review the allocation again.')
		const next = planPortfolioAllocations({ snapshot: latest, universeId, minimumIdleAttoRep, minimumHealthFactorBps, allocations })
		const nextRequest = buildPortfolioQuestionBatchRequest({ owner, vault, vaultAbi: vaultArtifact.abi, operations: next.operations, requireImmediate: true })
		if (next.idleAfterAttoRep !== captured.plan.idleAfterAttoRep || nextRequest.data !== encoded.data) throw new Error('Portfolio balances or commitments changed. Refresh and review the allocation again.')
	}
	validateSnapshot(captured.snapshot)
	return { request, validateSnapshot }
}

export function portfolioPolicyReviewRequest({
	owner,
	vault,
	previousPolicy,
	config,
	rules,
	client,
}: {
	owner: Address
	vault: Address
	previousPolicy: Awaited<ReturnType<typeof loadPortfolioPolicy>>
	config: PortfolioAllocationPolicyConfig
	rules: readonly PortfolioAllocationRule[]
	client: ReadClient
}): PortfolioTransaction {
	const captured = structuredClone({ config, rules, previousPolicy })
	const policy = captured.config
	const prior = captured.previousPolicy
	const request = buildPortfolioAllocationPolicyRequest({ owner, vault, vaultAbi: vaultArtifact.abi, expectedVersion: prior.version, expectedNonce: prior.nonce, config: captured.config, rules: captured.rules })
	return {
		...request,
		reviewDescription: [
			`Reviewed prior policy version ${prior.version}, nonce ${prior.nonce}.`,
			prior.config.executor === zeroAddress
				? 'No prior allocation authority is active.'
				: `Prior executor ${prior.config.executor}; universe ${prior.config.universeId}. Prior spending: ${formatEther(prior.spentDepositAttoRep)} of ${formatEther(prior.config.depositBudgetAttoRep)} REP deposits; ${formatEther(prior.spentCommitmentIncreaseAttoEth)} of ${formatEther(prior.config.commitmentIncreaseBudgetAttoEth)} ETH commitment increases.`,
			`Executor ${policy.executor}; universe ${policy.universeId}; expires ${new Date(Number(policy.expiresAt) * 1000).toISOString()}.`,
			`Cumulative budgets: ${formatEther(policy.depositBudgetAttoRep)} REP deposits and ${formatEther(policy.commitmentIncreaseBudgetAttoEth)} ETH commitment increases.`,
			...captured.rules.map(rule => `Question 0x${rule.questionId.toString(16)}: deposit budget ${formatEther(rule.depositBudgetAttoRep)} REP; commitment cap ${formatEther(rule.maximumCommitmentAttoEth)} ETH.`),
			`Minimum health ${formatUnits(policy.minimumHealthFactorBps, 2)}% (${policy.minimumHealthFactorBps} bps). Keep at least ${formatEther(policy.minimumIdleAttoRep)} REP idle. Replacing a policy grants fresh budgets; prior spending is not deducted. The executor may spend these budgets at any permitted time.`,
			'Manual vault execution revokes this policy. Transferring REP into the vault leaves the policy active.',
		].join('\n'),
		validateBeforeSubmit: async () => {
			const latest = await loadPortfolioPolicy(client, vault)
			if (latest.version !== prior.version || latest.nonce !== prior.nonce) throw new Error('Allocation authority changed. Refresh and review the policy again.')
		},
	}
}

export function portfolioReadClient(client: ReadClient): PortfolioReadClient {
	return {
		getChainId: () => client.getChainId(),
		getLogs: parameters => client.getLogs(parameters),
		readContract: parameters => client.readContract(parameters),
		getBlock: async parameters => {
			const block = await client.getBlock(parameters)
			if (block.number === undefined || block.hash === undefined) throw new Error('Portfolio snapshot requires a mined block.')
			return { number: block.number, hash: block.hash, timestamp: block.timestamp }
		},
	}
}

export async function loadPortfolioPolicy(client: ReadClient, vault: Address, snapshotBlockNumber?: bigint) {
	const blockNumber = snapshotBlockNumber ?? (await client.getBlock()).number
	if (blockNumber === undefined) throw new Error('Policy review requires a mined block.')
	const [policy, version, nonce] = await Promise.all([
		client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'allocationPolicy', blockNumber }),
		client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'allocationPolicyVersion', blockNumber }),
		client.readContract({ address: vault, abi: vaultArtifact.abi, functionName: 'allocationPolicyNonce', blockNumber }),
	])
	return { config: policy[0], repToken: policy[1], spentDepositAttoRep: policy[2], spentCommitmentIncreaseAttoEth: policy[3], version, nonce }
}

const vaultCreatedEvent = parseAbiItem('event VaultCreated(address indexed owner,address indexed vault)')
type PortfolioDiscoveryClient = Pick<ReadClient, 'getCode' | 'readContract'> & {
	getLogs(parameters: { event: typeof vaultCreatedEvent; args: { owner: Address }; fromBlock: bigint }): Promise<readonly Pick<TransactionLog, 'address' | 'data' | 'topics'>[]>
}

/** Demo discovery stays on the browser-local chain; production imports remain explicit. */
export async function discoverSimulationPortfolio(client: PortfolioDiscoveryClient, backend: 'simulation' | 'injected', owner: Address): Promise<Address | undefined> {
	if (backend !== 'simulation') return undefined
	const logs = await client.getLogs({ event: vaultCreatedEvent, args: { owner }, fromBlock: 0n })
	const candidates = new Set<string>()
	for (const log of [...logs].reverse()) {
		if (candidates.has(log.address.toLowerCase())) continue
		candidates.add(log.address.toLowerCase())
		try {
			const event = decodeEventLog({ abi: [vaultCreatedEvent], data: log.data, topics: log.topics })
			const args = event.args
			if (!('owner' in args && 'vault' in args) || typeof args['owner'] !== 'string' || typeof args['vault'] !== 'string') continue
			if (getAddress(args['owner']) !== getAddress(owner)) continue
			const { vault } = await loadPortfolioOwnerVault(client, log.address, owner)
			if (vault !== zeroAddress && getAddress(vault) === getAddress(args['vault'])) return log.address
		} catch (failure) {
			// A log signature is only a discovery hint; unrelated or spoofed emitters are skipped.
			console.warn('Skipped an unverified simulation portfolio candidate.', failure)
		}
	}
	return undefined
}

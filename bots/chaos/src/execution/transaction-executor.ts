import { createPublicClient, parseAbiItem, type Account, type Address, type Chain, type Hex, type TransactionReceipt, type Transport, type WalletClient, toHex, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { requestTransport } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import { assertSubmissionWindowOpen, prepareSignedTransaction, submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import { endpointLabel, sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { availableSettledValues, quorumValue, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import type { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '../config/settings.ts'
import { erc1155Abi, erc20Abi, openOracleAbi } from '../contracts/abi.ts'
import { assertCanonicalAnchorFreshness } from '../core/canonical-freshness.ts'
import type { OperationEvidence, OperationPlan, OperationPreflightCall, OperationStep } from '../operations/types.ts'
import { recordActivity, saveDurableState, type PendingTransactionIntent, type RuntimeState } from '../state/operator-state.ts'
import {
	captureWorkflowIntentSubmissionJournal,
	recoverableWorkflowForIntent,
	markWorkflowFailed,
	markWorkflowForRediscovery,
	markWorkflowStepConfirmed,
	markWorkflowIntentBroadcastAttempt,
	markWorkflowStepSigned,
	markWorkflowStepSubmitted,
	requireWorkflowStep,
	restoreWorkflowIntentSubmissionJournal,
	retainWorkflow,
	startWorkflow,
} from '../runtime/workflows.ts'
import { requireSuccessfulReceipt, validateStepReceiptEvidence, type BalanceEvidenceObservation, type StorageEvidenceObservation } from './receipt-validation.ts'
import { assertOperationPlanFresh, assertOperationPrincipalCaps, assertStepSafety, operationSubmissionLastValidBlock, unsignedQuantity } from './safety.ts'

type WriteClient = WalletClient<Transport, Chain, Account>
type RpcPool = ReturnType<typeof createRpcEndpointPool>

export const CHAOS_FINALITY_BLOCKS = 12n

export class TransactionAwaitingRecovery extends Error {
	readonly hash: Hex

	constructor(label: string, hash: Hex, reason: string) {
		super(`${label} transaction ${hash} requires recovery: ${reason}`)
		this.name = 'TransactionAwaitingRecovery'
		this.hash = hash
	}
}

export class OperationRediscoveryRequired extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause })
		this.name = 'OperationRediscoveryRequired'
	}
}

export type ExecutionEnvironment = {
	beforeBroadcast?: (() => Promise<void>) | undefined
	beforeSign?: (() => Promise<void>) | undefined
	chain: Chain
	clock?: (() => number) | undefined
	executionCancelled?: (() => boolean) | undefined
	finalityBlocks?: bigint | undefined
	pool: RpcPool
	sender: Address
	settings: OperatorSettings
	state: RuntimeState
	wallet?: WriteClient | undefined
}

export type CanonicalExecutionAnchor = {
	attestingRpcUrls: ReadonlySet<string>
	baseFeePerGas: bigint
	hash: Hex
	number: bigint
	timestamp: bigint
}

export type CanonicalCallAnchor = Pick<CanonicalExecutionAnchor, 'attestingRpcUrls' | 'number'>

type ExactRpcTransaction = {
	data: Hex
	from: Address
	gas?: Hex | undefined
	maxFeePerGas?: Hex | undefined
	maxPriorityFeePerGas?: Hex | undefined
	to: Address
	value: Hex
}

export function sameCanonicalAttesters(left: ReadonlySet<string>, right: ReadonlySet<string>) {
	return left.size === right.size && [...left].every(rpcUrl => right.has(rpcUrl))
}

export function sameCanonicalExecutionAnchor(left: CanonicalExecutionAnchor, right: CanonicalExecutionAnchor) {
	return left.number === right.number && left.hash.toLowerCase() === right.hash.toLowerCase() && sameCanonicalAttesters(left.attestingRpcUrls, right.attestingRpcUrls)
}

export function assertRequestedTransactionHash(returnedHash: Hex, requestedHash: Hex, label: string) {
	if (returnedHash.toLowerCase() !== requestedHash.toLowerCase()) {
		throw new Error(`${label} returned transaction hash ${returnedHash}, expected ${requestedHash}`)
	}
}

export function requiredConnectivity(settings: OperatorSettings) {
	if (settings.connectivity === undefined) throw new Error('Execution requires configured RPC connectivity')
	return settings.connectivity
}

export function executionReadClients(environment: ExecutionEnvironment) {
	const connectivity = requiredConnectivity(environment.settings)
	return [connectivity.readRpcUrl, ...connectivity.quorumRpcUrls].map(rpcUrl => ({
		client: createPublicClient({
			chain: environment.chain,
			transport: environment.pool.transportFor(rpcUrl),
		}),
		endpoint: endpointLabel(rpcUrl),
		rpcUrl,
	}))
}

function requiredExecutionWallet(environment: ExecutionEnvironment) {
	const wallet = environment.wallet
	if (wallet === undefined) throw new Error('Transaction execution requires the configured signer')
	if (wallet.account.address.toLowerCase() !== environment.sender.toLowerCase()) {
		throw new Error('Execution signer does not match the configured transaction sender')
	}
	return wallet
}

export function assertExecutionActive(environment: ExecutionEnvironment) {
	if (environment.executionCancelled?.() === true) {
		throw new Error('Chaos bot shutdown requested before transaction submission')
	}
	if (!environment.settings.runtime.execute) throw new Error('Transaction execution is disabled')
	if (environment.settings.paused || environment.state.paused) throw new Error('Chaos bot paused before transaction submission')
	if (environment.state.pendingTransactions.length > 1) throw new Error('Multiple pending transaction intents require manual reconciliation')
}

export function sharedQuorumBlockNumber(heads: readonly bigint[], requirement: number) {
	if (!Number.isSafeInteger(requirement) || requirement < 1) {
		throw new Error('Shared block quorum must be a positive integer')
	}
	if (heads.length < requirement) {
		throw new Error('Shared block selection does not have enough available heads')
	}
	const sorted = [...heads].sort((left, right) => {
		if (left === right) return 0
		return left > right ? -1 : 1
	})
	const selected = sorted[requirement - 1]
	if (selected === undefined) throw new Error('Shared block selection returned no block')
	return selected
}

export async function agreedLatestBlock(environment: ExecutionEnvironment, label: string): Promise<CanonicalExecutionAnchor> {
	const connectivity = requiredConnectivity(environment.settings)
	const readers = executionReadClients(environment)
	const settledHeads = await Promise.allSettled(
		readers.map(async reader => {
			const [chainId, value] = await Promise.all([reader.client.getChainId(), reader.client.getBlockNumber()])
			if (chainId !== environment.settings.network.chainId) {
				throw new Error(`RPC ${reader.endpoint} returned chain ID ${chainId.toString()}, expected ${environment.settings.network.chainId.toString()}`)
			}
			return { reader, value }
		}),
	)
	const heads = availableSettledValues(settledHeads)
	if (heads.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`${label} requires ${connectivity.rpcQuorum.toString()} available RPC endpoints`)
	}
	const blockNumber = sharedQuorumBlockNumber(
		heads.map(head => head.value),
		connectivity.rpcQuorum,
	)
	const settledBlocks = await Promise.allSettled(
		heads
			.filter(head => head.value >= blockNumber)
			.map(async ({ reader: { client, endpoint, rpcUrl } }) => {
				const candidate = await client.getBlock({ blockNumber })
				return {
					endpoint,
					rpcUrl,
					value: {
						baseFeePerGas: candidate.baseFeePerGas,
						hash: candidate.hash,
						number: candidate.number,
						timestamp: candidate.timestamp,
					},
				}
			}),
	)
	const blockObservations = availableSettledValues(settledBlocks)
	if (blockObservations.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`${label} requires ${connectivity.rpcQuorum.toString()} available RPC endpoints with block identity evidence`)
	}
	const block = quorumValue(
		label,
		blockObservations.map(({ endpoint, value }) => ({ endpoint, value })),
		connectivity.rpcQuorum,
	)
	if (block.number === undefined || block.hash == null || block.baseFeePerGas == null) {
		throw new Error(`${label} is missing EIP-1559 identity`)
	}
	if (block.number !== blockNumber) {
		throw new Error(`${label} returned block ${block.number.toString()}, expected ${blockNumber.toString()}`)
	}
	assertCanonicalAnchorFreshness(
		heads.map(head => head.value),
		block.number,
		block.timestamp,
		environment.clock?.() ?? Date.now(),
	)
	const blockHash = block.hash
	const attestingRpcUrls = new Set(blockObservations.filter(observation => observation.value.number === block.number && observation.value.hash?.toLowerCase() === blockHash.toLowerCase()).map(observation => observation.rpcUrl))
	if (attestingRpcUrls.size < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`${label} does not have enough RPC endpoints attesting its canonical identity`)
	}
	return {
		attestingRpcUrls,
		baseFeePerGas: block.baseFeePerGas,
		hash: blockHash,
		number: block.number,
		timestamp: block.timestamp,
	}
}

async function agreedPendingNonce(environment: ExecutionEnvironment, address: Address, capableRpcUrls?: ReadonlySet<string> | undefined) {
	const connectivity = requiredConnectivity(environment.settings)
	return settledQuorumValue(
		'pending signer nonce',
		executionReadClients(environment)
			.filter(({ rpcUrl }) => capableRpcUrls?.has(rpcUrl) ?? true)
			.map(async ({ client, endpoint }) => ({
				endpoint,
				value: await client.getTransactionCount({
					address,
					blockTag: 'pending',
				}),
			})),
		connectivity.rpcQuorum,
	)
}

async function agreedConfirmedNonce(environment: ExecutionEnvironment, address: Address, blockNumber: bigint) {
	const connectivity = requiredConnectivity(environment.settings)
	return settledQuorumValue(
		'confirmed signer nonce',
		executionReadClients(environment).map(async ({ client, endpoint }) => ({
			endpoint,
			value: await client.getTransactionCount({ address, blockNumber }),
		})),
		connectivity.rpcQuorum,
	)
}

export function assertNoUnmanagedPendingNonce(confirmedNonce: bigint, pendingNonce: bigint) {
	if (confirmedNonce < 0n || pendingNonce < 0n) {
		throw new Error('Signer nonces cannot be negative')
	}
	if (pendingNonce !== confirmedNonce) {
		throw new Error(`Signer has an unmanaged pending nonce: confirmed ${confirmedNonce.toString()}, pending ${pendingNonce.toString()}`)
	}
	return pendingNonce
}

async function agreedEthBalance(environment: ExecutionEnvironment, address: Address, blockNumber: bigint) {
	const connectivity = requiredConnectivity(environment.settings)
	return settledQuorumValue(
		`ETH balance for ${address}`,
		executionReadClients(environment).map(async ({ client, endpoint }) => ({
			endpoint,
			value: await client.getBalance({ address, blockNumber }),
		})),
		connectivity.rpcQuorum,
	)
}

async function agreedTokenBalance(environment: ExecutionEnvironment, token: Address, address: Address, blockNumber: bigint) {
	const connectivity = requiredConnectivity(environment.settings)
	return settledQuorumValue(
		`token ${token} balance for ${address}`,
		executionReadClients(environment).map(async ({ client, endpoint }) => ({
			endpoint,
			value: await client.readContract({
				abi: erc20Abi,
				address: token,
				args: [address],
				blockNumber,
				functionName: 'balanceOf',
			}),
		})),
		connectivity.rpcQuorum,
	)
}

export async function assertFreshWalletAssetDebits(environment: ExecutionEnvironment, step: Pick<OperationStep, 'label' | 'walletAssetDebits'>, anchor: CanonicalCallAnchor) {
	const erc20Debits = new Map<string, { address: Address; amount: bigint; categories: Set<string> }>()
	const erc1155Debits = new Map<string, { address: Address; amount: bigint; tokenId: bigint }>()
	const openOracleDebits = new Map<
		string,
		{
			amount: bigint
			asset: Address
			categories: Set<string>
			openOracle: Address
		}
	>()
	for (const debit of step.walletAssetDebits) {
		if (debit.kind === 'native') continue
		const amount = unsignedQuantity(debit.amount, `${step.label} wallet debit`)
		if (debit.kind === 'open-oracle-credit') {
			const asset = debit.asset === 'ETH' ? zeroAddress : debit.asset
			const key = `${debit.openOracle.toLowerCase()}:${asset.toLowerCase()}`
			const existing = openOracleDebits.get(key)
			if (existing === undefined) {
				openOracleDebits.set(key, {
					amount,
					asset,
					categories: new Set([debit.category]),
					openOracle: debit.openOracle,
				})
			} else {
				existing.amount += amount
				existing.categories.add(debit.category)
			}
			continue
		}
		if (debit.kind === 'erc20') {
			const key = debit.asset.toLowerCase()
			const existing = erc20Debits.get(key)
			if (existing === undefined) {
				erc20Debits.set(key, {
					address: debit.asset,
					amount,
					categories: new Set([debit.category]),
				})
			} else {
				existing.amount += amount
				existing.categories.add(debit.category)
			}
			continue
		}
		const tokenId = unsignedQuantity(debit.tokenId, `${step.label} ERC-1155 token id`)
		const key = `${debit.asset.toLowerCase()}:${tokenId.toString()}`
		const existing = erc1155Debits.get(key)
		if (existing === undefined) {
			erc1155Debits.set(key, { address: debit.asset, amount, tokenId })
		} else {
			existing.amount += amount
		}
	}
	for (const debit of erc20Debits.values()) {
		if (debit.categories.size !== 1) {
			throw new Error(`${step.label} assigns conflicting categories to token ${debit.address}`)
		}
	}
	for (const debit of openOracleDebits.values()) {
		if (debit.categories.size !== 1) {
			throw new Error(`${step.label} assigns conflicting categories to OpenOracle credit ${debit.openOracle}/${debit.asset}`)
		}
		if (debit.categories.has('rep') && debit.asset === zeroAddress) {
			throw new Error(`${step.label} cannot classify native OpenOracle credit as REP`)
		}
	}
	const repCreditAssets = new Set([...openOracleDebits.values()].flatMap(debit => (debit.categories.has('rep') ? [debit.asset.toLowerCase()] : [])))
	const tokenBalances = new Map<string, bigint>()
	for (const debit of erc20Debits.values()) {
		const balance = await exactAttestedTokenBalance(environment, debit.address, environment.sender, anchor)
		tokenBalances.set(debit.address.toLowerCase(), balance)
		const reserve = debit.categories.has('rep') && !repCreditAssets.has(debit.address.toLowerCase()) ? environment.settings.strategy.minimumRepReserveAttoRep : 0n
		if (balance < debit.amount + reserve) {
			throw new OperationRediscoveryRequired(`${step.label} would breach the fresh ${debit.categories.has('rep') ? 'REP reserve' : 'ERC-20 balance'} for ${debit.address}`)
		}
	}
	const creditBalances = new Map<string, bigint>()
	for (const debit of openOracleDebits.values()) {
		const credit = await exactAttestedOpenOracleCredit(environment, debit.openOracle, debit.asset, environment.sender, anchor)
		creditBalances.set(`${debit.openOracle.toLowerCase()}:${debit.asset.toLowerCase()}`, credit)
		if (credit <= debit.amount) {
			throw new OperationRediscoveryRequired(`${step.label} no longer has the declared OpenOracle credit plus its retained one-atto buffer`)
		}
	}
	for (const assetKey of repCreditAssets) {
		const creditDebits = [...openOracleDebits.values()].filter(debit => debit.categories.has('rep') && debit.asset.toLowerCase() === assetKey)
		const asset = creditDebits[0]?.asset
		if (asset === undefined) throw new Error(`${step.label} is missing its declared OpenOracle REP asset`)
		const walletDebit = erc20Debits.get(assetKey)?.amount ?? 0n
		let walletBalance = tokenBalances.get(assetKey)
		if (walletBalance === undefined) {
			walletBalance = await exactAttestedTokenBalance(environment, asset, environment.sender, anchor)
			tokenBalances.set(assetKey, walletBalance)
		}
		let internalBalance = 0n
		let internalDebit = 0n
		for (const debit of creditDebits) {
			const credit = creditBalances.get(`${debit.openOracle.toLowerCase()}:${assetKey}`)
			if (credit === undefined) throw new Error(`${step.label} is missing its fresh OpenOracle REP credit`)
			internalBalance += credit <= 1n ? 0n : credit - 1n
			internalDebit += debit.amount
		}
		const reserve = environment.settings.strategy.minimumRepReserveAttoRep
		if (walletBalance + internalBalance < walletDebit + internalDebit + reserve) {
			throw new OperationRediscoveryRequired(`${step.label} would breach the fresh combined wallet and OpenOracle REP reserve for ${asset}`)
		}
	}
	for (const debit of erc1155Debits.values()) {
		const balance = await exactAttestedErc1155Balance(environment, debit.address, environment.sender, debit.tokenId, anchor)
		if (balance < debit.amount) {
			throw new OperationRediscoveryRequired(`${step.label} no longer has the declared outcome-share balance`)
		}
	}
}

export async function captureBalanceEvidence(environment: ExecutionEnvironment, evidence: readonly OperationEvidence[], blockNumber: bigint) {
	const balances = new Map<string, bigint>()
	for (const expectation of evidence) {
		if (expectation.kind !== 'balance-change') continue
		const asset = expectation.asset === 'ETH' ? 'ETH' : expectation.asset.toLowerCase()
		const key = `${expectation.account.toLowerCase()}:${asset}`
		if (balances.has(key)) continue
		const balance = expectation.asset === 'ETH' ? await agreedEthBalance(environment, expectation.account, blockNumber) : await agreedTokenBalance(environment, expectation.asset, expectation.account, blockNumber)
		balances.set(key, balance)
	}
	return balances
}

function storageEvidenceKey(evidence: Pick<Extract<OperationEvidence, { kind: 'storage-postcondition' }>, 'args' | 'contract' | 'functionName'>) {
	return `${evidence.contract.toLowerCase()}:${evidence.functionName}:${JSON.stringify(evidence.args)}`
}

function storageArgument(value: string | boolean, type: string, label: string) {
	if (type === 'bool') {
		if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
		return value
	}
	if (/^u?int\d*$/.test(type)) {
		if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)$/.test(value)) {
			throw new Error(`${label} must be an integer string`)
		}
		return BigInt(value)
	}
	if (typeof value !== 'string') throw new Error(`${label} must be a string`)
	if (type.includes('[') || type.startsWith('tuple')) {
		throw new Error(`${label} uses an unsupported composite storage-evidence argument`)
	}
	return value
}

function storageRead(evidence: Extract<OperationEvidence, { kind: 'storage-postcondition' }>) {
	if (evidence.abi === undefined || evidence.args === undefined) {
		throw new Error(`${evidence.functionName} storage evidence is missing its typed read declaration`)
	}
	const item = parseAbiItem(evidence.abi)
	if (item.type !== 'function' || !('outputs' in item) || !('stateMutability' in item) || item.name !== evidence.functionName) {
		throw new Error(`${evidence.functionName} storage evidence has a mismatched function ABI`)
	}
	if (item.stateMutability !== 'view' && item.stateMutability !== 'pure') {
		throw new Error(`${evidence.functionName} storage evidence must use a read-only function`)
	}
	if (item.outputs.length !== 1) {
		throw new Error(`${evidence.functionName} storage evidence must return one scalar value`)
	}
	if (item.inputs.length !== evidence.args.length) {
		throw new Error(`${evidence.functionName} storage evidence argument count does not match its ABI`)
	}
	return {
		abi: [item],
		args: evidence.args.map((argument, index) => {
			const input = item.inputs[index]
			if (input === undefined) throw new Error(`${evidence.functionName} storage evidence is missing input ${index.toString()}`)
			return storageArgument(argument, input.type, `${evidence.functionName} argument ${index.toString()}`)
		}),
	}
}

function canonicalStorageValue(value: unknown, label: string) {
	if (typeof value === 'bigint' || typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? 'true' : 'false'
	if (typeof value === 'string') return /^0x[0-9a-fA-F]+$/.test(value) ? value.toLowerCase() : value
	throw new Error(`${label} returned a non-scalar storage evidence value`)
}

export async function captureStorageEvidence(environment: ExecutionEnvironment, evidence: readonly OperationEvidence[], blockNumber: bigint) {
	const connectivity = requiredConnectivity(environment.settings)
	const values = new Map<string, string>()
	for (const expectation of evidence) {
		if (expectation.kind !== 'storage-postcondition') continue
		const key = storageEvidenceKey(expectation)
		if (values.has(key)) continue
		const read = storageRead(expectation)
		const value = await settledQuorumValue(
			`${expectation.contract}.${expectation.functionName} storage evidence`,
			executionReadClients(environment).map(async ({ client, endpoint }) => ({
				endpoint,
				value: canonicalStorageValue(
					await client.readContract({
						abi: read.abi,
						address: expectation.contract,
						args: read.args,
						blockNumber,
						functionName: expectation.functionName,
					}),
					`${expectation.contract}.${expectation.functionName}`,
				),
			})),
			connectivity.rpcQuorum,
		)
		values.set(key, value)
	}
	return values
}

export function balanceObservations(evidence: readonly OperationEvidence[], before: ReadonlyMap<string, bigint>, after: ReadonlyMap<string, bigint>): BalanceEvidenceObservation[] {
	return evidence.flatMap(expectation => {
		if (expectation.kind !== 'balance-change') return []
		const asset = expectation.asset === 'ETH' ? 'ETH' : expectation.asset.toLowerCase()
		const key = `${expectation.account.toLowerCase()}:${asset}`
		const beforeBalance = before.get(key)
		const afterBalance = after.get(key)
		if (beforeBalance === undefined || afterBalance === undefined) {
			throw new Error(`Missing captured balance evidence for ${expectation.account}`)
		}
		return [{ after: afterBalance, before: beforeBalance, evidence: expectation }]
	})
}

export function storageObservations(evidence: readonly OperationEvidence[], before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): StorageEvidenceObservation[] {
	return evidence.flatMap(expectation => {
		if (expectation.kind !== 'storage-postcondition') return []
		if (expectation.args === undefined) {
			throw new Error(`${expectation.functionName} storage evidence is missing its arguments`)
		}
		const key = storageEvidenceKey(expectation)
		const beforeValue = before.get(key)
		const afterValue = after.get(key)
		if (beforeValue === undefined || afterValue === undefined) {
			throw new Error(`Missing captured storage evidence for ${expectation.contract}.${expectation.functionName}`)
		}
		return [{ after: afterValue, before: beforeValue, evidence: expectation }]
	})
}

function durableBalanceBaselines(evidence: readonly OperationEvidence[], balances: ReadonlyMap<string, bigint>): PendingTransactionIntent['semanticExpectation']['balanceBaselines'] {
	return evidence.flatMap(expectation => {
		if (expectation.kind !== 'balance-change') return []
		const assetKey = expectation.asset === 'ETH' ? 'ETH' : expectation.asset.toLowerCase()
		const balance = balances.get(`${expectation.account.toLowerCase()}:${assetKey}`)
		if (balance === undefined) throw new Error(`Missing balance baseline for ${expectation.account}`)
		return [
			{
				account: expectation.account,
				asset: expectation.asset,
				balance: balance.toString(),
			},
		]
	})
}

function durableStorageBaselines(evidence: readonly OperationEvidence[], values: ReadonlyMap<string, string>): PendingTransactionIntent['semanticExpectation']['storageBaselines'] {
	return evidence.flatMap(expectation => {
		if (expectation.kind !== 'storage-postcondition') return []
		const value = values.get(storageEvidenceKey(expectation))
		if (value === undefined) {
			throw new Error(`Missing storage baseline for ${expectation.contract}.${expectation.functionName}`)
		}
		return [
			{
				args: expectation.args,
				contract: expectation.contract,
				functionName: expectation.functionName,
				value,
			},
		]
	})
}

type ExecutionReadClient = ReturnType<typeof executionReadClients>[number]

function canonicalAttestingReaders(environment: ExecutionEnvironment, label: string, attestingRpcUrls: ReadonlySet<string>) {
	const connectivity = requiredConnectivity(environment.settings)
	const readers = executionReadClients(environment).filter(({ rpcUrl }) => attestingRpcUrls.has(rpcUrl))
	if (attestingRpcUrls.size < connectivity.rpcQuorum || readers.length !== attestingRpcUrls.size) {
		throw new ConnectivityDegradedError(`${label} requires every canonical attesting RPC endpoint to remain configured`)
	}
	return readers
}

async function everyCanonicalAttester<T>(environment: ExecutionEnvironment, label: string, attestingRpcUrls: ReadonlySet<string>, read: (reader: ExecutionReadClient) => Promise<T>) {
	const readers = canonicalAttestingReaders(environment, label, attestingRpcUrls)
	const settled = await Promise.allSettled(readers.map(read))
	const available = availableSettledValues(settled)
	if (available.length !== readers.length) {
		const unavailable = settled.flatMap((result, index) => {
			if (result.status === 'fulfilled') return []
			const reader = readers[index]
			return reader === undefined ? [] : [reader.endpoint]
		})
		throw new ConnectivityDegradedError(`${label} requires every canonical attesting RPC endpoint${unavailable.length === 0 ? '' : `; unavailable: ${unavailable.join(', ')}`}`)
	}
	return available
}

export async function exactAttestedEthBalance(environment: ExecutionEnvironment, address: Address, anchor: CanonicalCallAnchor) {
	const label = `ETH balance for ${address}`
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ client, endpoint }) => ({
		endpoint,
		value: await client.getBalance({ address, blockNumber: anchor.number }),
	}))
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

async function exactAttestedTokenBalance(environment: ExecutionEnvironment, token: Address, address: Address, anchor: CanonicalCallAnchor) {
	const label = `token ${token} balance for ${address}`
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ client, endpoint }) => ({
		endpoint,
		value: await client.readContract({
			abi: erc20Abi,
			address: token,
			args: [address],
			blockNumber: anchor.number,
			functionName: 'balanceOf',
		}),
	}))
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

async function exactAttestedOpenOracleCredit(environment: ExecutionEnvironment, openOracle: Address, asset: Address, address: Address, anchor: CanonicalCallAnchor) {
	const label = `OpenOracle ${openOracle} credit for ${address} and ${asset}`
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ client, endpoint }) => ({
		endpoint,
		value: await client.readContract({
			abi: openOracleAbi,
			address: openOracle,
			args: [address, asset],
			blockNumber: anchor.number,
			functionName: 'tokenHolder',
		}),
	}))
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

async function exactAttestedErc1155Balance(environment: ExecutionEnvironment, token: Address, address: Address, tokenId: bigint, anchor: CanonicalCallAnchor) {
	const label = `ERC-1155 ${token} balance ${tokenId.toString()} for ${address}`
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ client, endpoint }) => ({
		endpoint,
		value: await client.readContract({
			abi: erc1155Abi,
			address: token,
			args: [address, tokenId],
			blockNumber: anchor.number,
			functionName: 'balanceOf',
		}),
	}))
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

export async function agreedExactCall(environment: ExecutionEnvironment, label: string, transaction: ExactRpcTransaction, anchor: CanonicalCallAnchor) {
	const blockTag = toHex(anchor.number)
	const read = async ({ endpoint, rpcUrl }: ExecutionReadClient) => {
		const result = await requestTransport<unknown>(environment.pool.transportFor(rpcUrl), {
			method: 'eth_call',
			params: [transaction, blockTag],
		})
		if (typeof result !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) {
			throw new Error(`${label} RPC returned invalid simulation data`)
		}
		return { endpoint, value: result.toLowerCase() }
	}
	const observations = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, read)
	return quorumValue(label, observations, requiredConnectivity(environment.settings).rpcQuorum)
}

export async function agreedMaximumGasEstimate(environment: ExecutionEnvironment, label: string, transaction: ExactRpcTransaction, anchor: CanonicalCallAnchor) {
	const blockTag = toHex(anchor.number)
	const estimates = await everyCanonicalAttester(environment, label, anchor.attestingRpcUrls, async ({ endpoint, rpcUrl }) => {
		const result = await requestTransport<unknown>(environment.pool.transportFor(rpcUrl), {
			method: 'eth_estimateGas',
			params: [transaction, blockTag],
		})
		if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) {
			throw new Error(`${label} RPC returned an invalid gas estimate`)
		}
		const value = BigInt(result)
		if (value === 0n) throw new Error(`${label} RPC returned a zero gas estimate`)
		return { endpoint, value }
	})
	return estimates.reduce((maximum, estimate) => (estimate.value > maximum ? estimate.value : maximum), 0n)
}

function preflightTransaction(call: OperationPreflightCall) {
	return {
		data: call.data,
		from: call.caller,
		to: call.to,
		value: toHex(unsignedQuantity(call.value, `${call.label} value`)),
	}
}

export async function assertStepPreflightCalls(environment: ExecutionEnvironment, step: Pick<OperationStep, 'label' | 'preflightCalls'>, anchor: CanonicalCallAnchor) {
	for (const call of step.preflightCalls) {
		try {
			const result = await agreedExactCall(environment, `${step.label} downstream preflight: ${call.label}`, preflightTransaction(call), anchor)
			if (result.toLowerCase() !== call.expectedResult.toLowerCase()) {
				throw new OperationRediscoveryRequired(`${step.label} downstream call returned a different semantic result at the canonical pre-signing block: ${call.label}`)
			}
		} catch (error) {
			if (error instanceof OperationRediscoveryRequired) throw error
			if (executionRevert(error)) {
				throw new OperationRediscoveryRequired(`${step.label} downstream call no longer succeeds at the canonical pre-signing block: ${call.label}`, error)
			}
			throw error
		}
	}
}

async function agreedSimulationAndGas(environment: ExecutionEnvironment, step: OperationStep, anchor: CanonicalCallAnchor) {
	const account = environment.sender
	const value = unsignedQuantity(step.value, `${step.label} value`)
	const gasLimit = unsignedQuantity(step.gasLimit, `${step.label} gas limit`)
	const rpcTransaction = {
		from: account,
		data: step.data,
		gas: toHex(gasLimit),
		to: step.to,
		value: toHex(value),
	}
	await agreedExactCall(environment, `${step.label} exact simulation`, rpcTransaction, anchor)
	return await agreedMaximumGasEstimate(environment, `${step.label} gas estimate`, rpcTransaction, anchor)
}

function executionRevert(error: unknown) {
	return error instanceof Error && /(?:execution reverted|\brevert(?:ed|ing)?\b|always failing transaction)/i.test(error.message)
}

async function rediscoverableSimulationAndGas(environment: ExecutionEnvironment, step: OperationStep, anchor: CanonicalCallAnchor) {
	try {
		return await agreedSimulationAndGas(environment, step, anchor)
	} catch (error) {
		if (executionRevert(error)) {
			throw new OperationRediscoveryRequired(`${step.label} no longer succeeds at the canonical pre-signing block`, error)
		}
		throw error
	}
}

function missingReceipt(error: unknown) {
	return error instanceof Error && (error.name === 'TransactionReceiptNotFoundError' || error.message.toLowerCase().includes('could not be found'))
}

export async function finalizedReceiptWithQuorum(environment: ExecutionEnvironment, hash: Hex) {
	const connectivity = requiredConnectivity(environment.settings)
	const finalityAnchor = await agreedLatestBlock(environment, `receipt ${hash} finality anchor`)
	const readers = canonicalAttestingReaders(environment, `receipt ${hash} finality`, finalityAnchor.attestingRpcUrls)
	type ReceiptEvidence = {
		blockHash: Hex
		blockNumber: bigint
		hash: Hex
		logs: { address: Address; data: Hex; topics: readonly Hex[] }[]
		status: 'reverted' | 'success'
	}
	const settledObservations = await Promise.allSettled(
		readers.map(async reader => {
			let receipt: TransactionReceipt | undefined
			try {
				receipt = await reader.client.getTransactionReceipt({ hash })
				assertRequestedTransactionHash(receipt.transactionHash, hash, `RPC ${reader.endpoint} receipt lookup`)
			} catch (error) {
				if (!missingReceipt(error)) throw error
			}
			return {
				head: await reader.client.getBlockNumber(),
				reader,
				receipt,
			}
		}),
	)
	const observations = availableSettledValues(settledObservations)
	if (observations.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`receipt ${hash} requires ${connectivity.rpcQuorum.toString()} available RPC endpoints with head evidence`)
	}
	const receiptObservations = observations.flatMap(({ reader, receipt }) => {
		if (receipt === undefined) return []
		const value: ReceiptEvidence = {
			blockHash: receipt.blockHash,
			blockNumber: receipt.blockNumber,
			hash: receipt.transactionHash,
			logs: receipt.logs.map(log => ({
				address: log.address,
				data: log.data,
				topics: log.topics,
			})),
			status: receipt.status,
		}
		return [{ endpoint: reader.endpoint, receipt, value }]
	})
	if (receiptObservations.length === 0) {
		return { observed: false as const, receipt: undefined }
	}
	if (receiptObservations.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`receipt ${hash} requires ${connectivity.rpcQuorum.toString()} available RPC endpoints with matching receipt evidence`)
	}
	const evidence = quorumValue(
		`receipt ${hash}`,
		receiptObservations.map(({ endpoint, value }) => ({ endpoint, value })),
		connectivity.rpcQuorum,
	)
	const capableObservations = observations.flatMap(observation => {
		if (observation.head < evidence.blockNumber) {
			if (observation.receipt === undefined) return []
			throw new Error(`RPC disagreement for receipt ${hash}: ${observation.reader.endpoint} returned a receipt at block ${evidence.blockNumber.toString()} above its reported head ${observation.head.toString()}`)
		}
		if (observation.receipt === undefined) {
			throw new Error(`RPC disagreement for receipt ${hash}: ${observation.reader.endpoint} reported head ${observation.head.toString()} but could not find the receipt at block ${evidence.blockNumber.toString()}`)
		}
		return [observation]
	})
	if (capableObservations.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`receipt ${hash} requires ${connectivity.rpcQuorum.toString()} capable RPC endpoints`)
	}
	const receipt = receiptObservations.find(candidate => candidate.value.blockHash.toLowerCase() === evidence.blockHash.toLowerCase() && candidate.value.blockNumber === evidence.blockNumber && candidate.value.hash.toLowerCase() === evidence.hash.toLowerCase())?.receipt
	if (receipt === undefined) throw new Error(`Receipt ${hash} quorum evidence is missing its source receipt`)
	const finalized = await confirmCanonicalReceiptFinality(
		capableObservations.map(observation => observation.reader.client),
		capableObservations.map(observation => observation.reader.endpoint),
		`transaction ${hash}`,
		receipt,
		environment.finalityBlocks ?? CHAOS_FINALITY_BLOCKS,
		undefined,
		connectivity.rpcQuorum,
	)
	return finalized ? { observed: true as const, receipt } : { observed: true as const, receipt: undefined }
}

async function persist(environment: ExecutionEnvironment) {
	await saveDurableState(environment.settings.runtime.stateFile, environment.state)
}

async function assertSignedIntentBroadcastReadiness(environment: ExecutionEnvironment, intent: PendingTransactionIntent, signingAnchor: CanonicalExecutionAnchor) {
	const anchor = await agreedLatestBlock(environment, `${intent.label} pre-broadcast block`)
	try {
		assertSubmissionWindowOpen(intent.maxBlockNumber, anchor.number)
	} catch (error) {
		throw new TransactionAwaitingRecovery(intent.label, intent.hash, `signed submission window closed before broadcast: ${error instanceof Error ? error.message : String(error)}`)
	}
	if (!sameCanonicalExecutionAnchor(anchor, signingAnchor)) {
		throw new TransactionAwaitingRecovery(intent.label, intent.hash, 'canonical signing anchor or its attester set changed after signed intent journaling')
	}
	const pendingNonce = await agreedPendingNonce(environment, intent.sender, anchor.attestingRpcUrls)
	if (pendingNonce !== intent.nonce) {
		throw new TransactionAwaitingRecovery(intent.label, intent.hash, pendingNonce > intent.nonce ? `signer nonce ${intent.nonce.toString()} was consumed before broadcast` : `signer pending nonce moved backward to ${pendingNonce.toString()} before broadcast`)
	}
}

function createIntent(
	environment: ExecutionEnvironment,
	plan: OperationPlan,
	workflowId: string,
	step: OperationStep,
	signed: Awaited<ReturnType<typeof prepareSignedTransaction>>,
	balanceBaselines: PendingTransactionIntent['semanticExpectation']['balanceBaselines'],
	storageBaselines: PendingTransactionIntent['semanticExpectation']['storageBaselines'],
): PendingTransactionIntent {
	return {
		data: step.data,
		hash: signed.hash,
		id: `intent:${signed.hash.slice(2)}`,
		label: step.label,
		maxBlockNumber: signed.maxBlockNumber,
		mode: environment.settings.submission.mode,
		nonce: signed.transaction.nonce,
		operationId: plan.definitionId,
		semanticExpectation: {
			balanceBaselines,
			evidence: step.evidence,
			postconditions: plan.postconditions,
			storageBaselines,
		},
		sender: environment.sender,
		serializedTransaction: signed.serializedTransaction,
		signedAt: new Date().toISOString(),
		status: 'signed',
		stepId: step.id,
		to: step.to,
		value: signed.transaction.value,
		workflowId,
	}
}

async function executeStep(environment: ExecutionEnvironment, plan: OperationPlan, workflowId: string, step: OperationStep) {
	assertExecutionActive(environment)
	const wallet = requiredExecutionWallet(environment)
	const account = wallet.account
	if (account.signTransaction === undefined || account.signMessage === undefined) {
		throw new Error('Execution signer cannot sign and authenticate transactions')
	}
	await environment.beforeSign?.()
	assertExecutionActive(environment)
	const block = await agreedLatestBlock(environment, `${step.label} signing block`)
	try {
		assertOperationPlanFresh(plan, block.number, environment.settings.strategy.workflowValidForBlocks)
	} catch (error) {
		if (error instanceof Error && error.message.includes('expired before execution')) {
			throw new OperationRediscoveryRequired(error.message, error)
		}
		throw error
	}
	const ethBalanceAttoEth = await exactAttestedEthBalance(environment, account.address, block)
	await assertFreshWalletAssetDebits(environment, step, block)
	const beforeBalances = await captureBalanceEvidence(environment, step.evidence, block.number)
	const beforeStorage = await captureStorageEvidence(environment, step.evidence, block.number)
	await assertStepPreflightCalls(environment, step, block)
	const gasEstimate = await rediscoverableSimulationAndGas(environment, step, block)
	try {
		assertStepSafety({
			baseFeePerGas: block.baseFeePerGas,
			ethBalanceAttoEth,
			gasEstimate,
			step,
			strategy: environment.settings.strategy,
		})
	} catch (error) {
		if (error instanceof Error && (error.message.includes('estimated gas ceiling exceeds') || error.message.includes('would breach the wallet ETH reserve'))) {
			throw new OperationRediscoveryRequired(error.message, error)
		}
		throw error
	}
	assertExecutionActive(environment)
	const confirmedNonce = await agreedConfirmedNonce(environment, account.address, block.number)
	const pendingNonce = await agreedPendingNonce(environment, account.address)
	assertExecutionActive(environment)
	const nonce = assertNoUnmanagedPendingNonce(confirmedNonce, pendingNonce)
	const signingAnchor = await agreedLatestBlock(environment, `${step.label} signing block`)
	if (!sameCanonicalExecutionAnchor(signingAnchor, block)) {
		throw new OperationRediscoveryRequired(`${step.label} canonical signing anchor or its attester set changed during pre-signing checks`)
	}
	assertExecutionActive(environment)
	let lastValidBlockNumber: bigint | undefined
	try {
		lastValidBlockNumber = operationSubmissionLastValidBlock(plan, block.number, block.timestamp, environment.settings.submission.mode)
	} catch (error) {
		throw new OperationRediscoveryRequired(error instanceof Error ? error.message : String(error), error)
	}
	const signed = await prepareSignedTransaction({
		baseFeePerGas: block.baseFeePerGas,
		blockNumber: block.number,
		chainId: environment.settings.network.chainId,
		data: step.data,
		from: account.address,
		gasEstimate,
		lastValidBlockNumber,
		nonce,
		signTransaction: account.signTransaction,
		to: step.to,
		value: unsignedQuantity(step.value, `${step.label} value`),
	})
	const intent = createIntent(environment, plan, workflowId, step, signed, durableBalanceBaselines(step.evidence, beforeBalances), durableStorageBaselines(step.evidence, beforeStorage))
	const workflow = recoverableWorkflowForIntent(environment.state, workflowId)
	environment.state.pendingTransactions.push(intent)
	markWorkflowStepSigned(workflow, step.id, intent.id, intent.hash)
	recordActivity(environment.state, {
		ecosystem: plan.ecosystem,
		hash: intent.hash,
		message: `Signed intent persisted: ${step.label}`,
		operationId: plan.definitionId,
		status: 'pending',
		type: 'transaction',
	})
	await persist(environment)
	assertExecutionActive(environment)
	await assertSignedIntentBroadcastReadiness(environment, intent, block)
	assertExecutionActive(environment)
	const broadcastJournal = captureWorkflowIntentSubmissionJournal(workflow, intent)
	markWorkflowIntentBroadcastAttempt(workflow, intent, block.number)
	await persist(environment)
	assertExecutionActive(environment)
	try {
		await environment.beforeBroadcast?.()
		assertExecutionActive(environment)
		await assertSignedIntentBroadcastReadiness(environment, intent, block)
		assertExecutionActive(environment)
	} catch (error) {
		restoreWorkflowIntentSubmissionJournal(workflow, intent, broadcastJournal)
		recordActivity(environment.state, {
			ecosystem: plan.ecosystem,
			hash: intent.hash,
			message: `Submission deferred before network broadcast: ${step.label}`,
			operationId: plan.definitionId,
			status: 'pending',
			type: 'recovery',
		})
		await persist(environment)
		if (error instanceof TransactionAwaitingRecovery) throw error
		throw new TransactionAwaitingRecovery(step.label, intent.hash, error instanceof Error ? error.message : String(error))
	}
	try {
		await submitSignedTransaction({
			address: account.address,
			hash: signed.hash,
			maxBlockNumber: signed.maxBlockNumber,
			publicRpcUrls: requiredConnectivity(environment.settings).publicRpcUrls,
			publicSubmit: sendRawTransactionToRpc,
			serializedTransaction: signed.serializedTransaction,
			settings: environment.settings.submission,
			signMessage: account.signMessage,
		})
	} catch (error) {
		recordActivity(environment.state, {
			ecosystem: plan.ecosystem,
			hash: intent.hash,
			message: `Submission outcome unknown: ${step.label}`,
			operationId: plan.definitionId,
			status: 'pending',
			type: 'recovery',
		})
		await persist(environment)
		throw new TransactionAwaitingRecovery(step.label, intent.hash, error instanceof Error ? error.message : String(error))
	}
	intent.status = 'submitted'
	intent.submissionBlock = block.number
	intent.submittedAt = new Date().toISOString()
	markWorkflowStepSubmitted(workflow, step.id)
	recordActivity(environment.state, {
		ecosystem: plan.ecosystem,
		hash: intent.hash,
		message: `Submitted: ${step.label}`,
		operationId: plan.definitionId,
		status: 'pending',
		type: 'transaction',
	})
	await persist(environment)
	const finalized = await finalizedReceiptWithQuorum(environment, intent.hash)
	if (finalized.receipt === undefined) {
		intent.status = 'confirmation-unknown'
		await persist(environment)
		throw new TransactionAwaitingRecovery(step.label, intent.hash, finalized.observed ? 'awaiting canonical finality' : 'receipt is not visible to the RPC quorum')
	}
	let receipt
	try {
		receipt = requireSuccessfulReceipt(step.label, finalized.receipt)
	} catch (error) {
		environment.state.pendingTransactions = environment.state.pendingTransactions.filter(candidate => candidate.id !== intent.id)
		markWorkflowFailed(workflow, step.id, error, 'receipt-reverted')
		recordActivity(environment.state, {
			ecosystem: plan.ecosystem,
			hash: intent.hash,
			message: `Confirmed transaction reverted: ${step.label}`,
			operationId: plan.definitionId,
			status: 'failed',
			type: 'transaction',
		})
		await persist(environment)
		throw error
	}
	let afterBalances: Awaited<ReturnType<typeof captureBalanceEvidence>>
	let afterStorage: Awaited<ReturnType<typeof captureStorageEvidence>>
	try {
		afterBalances = await captureBalanceEvidence(environment, step.evidence, receipt.blockNumber)
		afterStorage = await captureStorageEvidence(environment, step.evidence, receipt.blockNumber)
	} catch (error) {
		intent.status = 'confirmation-unknown'
		await persist(environment)
		throw new TransactionAwaitingRecovery(step.label, intent.hash, `confirmed receipt evidence is temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`)
	}
	try {
		validateStepReceiptEvidence(step, receipt, {
			balances: balanceObservations(step.evidence, beforeBalances, afterBalances),
			storage: storageObservations(step.evidence, beforeStorage, afterStorage),
		})
	} catch (error) {
		environment.state.pendingTransactions = environment.state.pendingTransactions.filter(candidate => candidate.id !== intent.id)
		markWorkflowFailed(workflow, step.id, error, 'semantic-failure')
		recordActivity(environment.state, {
			ecosystem: plan.ecosystem,
			hash: intent.hash,
			message: `Confirmed transaction failed semantic validation: ${step.label}`,
			operationId: plan.definitionId,
			status: 'failed',
			type: 'transaction',
		})
		await persist(environment)
		throw error
	}
	environment.state.pendingTransactions = environment.state.pendingTransactions.filter(candidate => candidate.id !== intent.id)
	markWorkflowStepConfirmed(workflow, step.id, receipt.transactionHash)
	recordActivity(environment.state, {
		ecosystem: plan.ecosystem,
		hash: receipt.transactionHash,
		message: step.label,
		operationId: plan.definitionId,
		status: 'confirmed',
		type: 'transaction',
	})
	await persist(environment)
}

export async function executeOperationPlan(environment: ExecutionEnvironment, plan: OperationPlan) {
	if (environment.state.pendingTransactions.length !== 0) {
		throw new Error('Pending transaction recovery must complete before a new operation')
	}
	assertOperationPrincipalCaps(plan, environment.settings.strategy)
	const workflow = retainWorkflow(environment.state, plan)
	startWorkflow(workflow)
	recordActivity(environment.state, {
		ecosystem: plan.ecosystem,
		message: `Starting operation: ${plan.label}`,
		operationId: plan.definitionId,
		status: 'info',
		type: 'operation',
	})
	await persist(environment)
	try {
		for (const step of plan.steps) {
			if (requireWorkflowStep(workflow, step.id).status === 'confirmed') continue
			await executeStep(environment, plan, workflow.id, step)
		}
		return workflow
	} catch (error) {
		if (error instanceof TransactionAwaitingRecovery) throw error
		const pending = environment.state.pendingTransactions.find(intent => intent.workflowId === workflow.id)
		if (pending !== undefined) {
			throw new TransactionAwaitingRecovery(pending.label, pending.hash, error instanceof Error ? error.message : String(error))
		}
		if (workflow.status !== 'failed') {
			markWorkflowForRediscovery(workflow, error)
			recordActivity(environment.state, {
				ecosystem: plan.ecosystem,
				message: `Operation preflight stopped: ${plan.label}`,
				operationId: plan.definitionId,
				status: 'skipped',
				type: 'operation',
			})
			await persist(environment)
		}
		throw error
	}
}

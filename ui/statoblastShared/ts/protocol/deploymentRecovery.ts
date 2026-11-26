import { concatHex, decodeFunctionData, encodeAbiParameters, getCreate2Address, getCreateAddress, keccak256, parseAbi, parseAbiParameters, TransactionLookupNotFoundError, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { hasErrorCode, hasErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { deployment as copy } from '../copy/securityPoolTransactions.js'
import { getInfraContractAddresses, getSecurityPoolCreationCode } from './deploymentHelpers.js'
import type { SecurityPoolTransaction } from './securityPool.js'
import { loadSecurityPoolAdmission, type SecurityPoolAdmission } from './securityPoolAdmission.js'

type ConfirmationClient = Pick<ReadClient, 'getBlock' | 'getTransactionCount'>
type CuratedAdmissionMode = Exclude<SecurityPoolAdmission['mode'], 'custom'>

const recoveryConfirmationDepth = 12n
// SecurityPoolFactory.securityPoolCreationCount is private. The compiled storage layout is checked in deploymentRecovery.test.ts.
const securityPoolCreationCountSlot = 7n
const ownerAndCounter = parseAbiParameters('address, uint256')
const poolDeploymentAbi = parseAbi(['function deploySecurityPool(bytes creationCode, bytes configuration) returns (address)', 'function isSecurityPool(address) view returns (bool)'])
const poolModuleParameters = parseAbiParameters('address, address, address, address, address, address, address, address, address, address')

function providerFailureMessage(error: unknown) {
	if (typeof error === 'string') return error
	return hasErrorMessage(error) ? error.message : ''
}

export async function readDeploymentRecoveryHead(client: Pick<ReadClient, 'getBlock'>) {
	for (const blockTag of ['finalized', 'safe'] as const) {
		try {
			const block = await client.getBlock({ blockTag })
			if (block?.number !== undefined && block.hash !== undefined) return block
		} catch (error) {
			const unsupported = (hasErrorCode(error) && [-32601, -32602, -32004].includes(Number(error.code))) || /unsupported|not supported|not implemented|(?:invalid|unknown|unrecognized) block tag|\b(?:RPC|finalized|safe) block not found\b/i.test(providerFailureMessage(error))
			if (!unsupported) throw error
		}
	}
	const latest = await client.getBlock({ blockTag: 'latest' })
	if (latest?.number === undefined || latest.number < recoveryConfirmationDepth) return undefined
	return client.getBlock({ blockNumber: latest.number - recoveryConfirmationDepth })
}

async function readSpentNonceHead(client: ConfirmationClient, owner: Address, nonce: bigint) {
	const head = await readDeploymentRecoveryHead(client)
	if (head?.number === undefined || head.hash === undefined || (await client.getTransactionCount({ address: owner, blockNumber: head.number })) <= nonce) return undefined
	return { number: head.number, hash: head.hash }
}

export async function readDeploymentNonce(client: Pick<ReadClient, 'getTransaction'>, owner: Address, hash: Hash) {
	try {
		const transaction = await client.getTransaction({ hash })
		if (transaction.hash.toLowerCase() === hash.toLowerCase() && transaction.from.toLowerCase() === owner.toLowerCase()) return transaction.nonce.toString()
	} catch (error) {
		if (!(error instanceof TransactionLookupNotFoundError) || error.kind !== 'transaction') throw error
	}
	return undefined
}

export async function matchesQuestionRules(client: Pick<ReadClient, 'getCode' | 'readContract'>, address: Address, mode: CuratedAdmissionMode, universeId: bigint, ids: readonly bigint[], blockNumber?: bigint) {
	const policy = await loadSecurityPoolAdmission(client, address, universeId, blockNumber)
	if (policy.mode !== mode) return false
	if (policy.mode !== 'fixed') return true
	if (policy.questionCount !== BigInt(ids.length) || !matchesPage(policy.questions, ids.slice(0, 64))) return false
	for (let start = policy.questions.length; start < ids.length; start += 64) {
		const page = await loadSecurityPoolAdmission(client, address, universeId, blockNumber, BigInt(start))
		if (page.mode !== 'fixed' || !matchesPage(page.questions, ids.slice(start, start + 64))) return false
	}
	return true
}

function matchesPage(actual: readonly bigint[], expected: readonly bigint[]) {
	return actual.length === expected.length && actual.every((id, index) => id === expected[index])
}

export async function recoverQuestionRules(client: ConfirmationClient & Pick<ReadClient, 'getCode' | 'readContract'>, owner: Address, nonce: bigint, mode: CuratedAdmissionMode, universeId: bigint, ids: readonly bigint[]) {
	const head = await readSpentNonceHead(client, owner, nonce)
	if (head === undefined) return undefined
	const address = getCreateAddress({ from: owner, nonce })
	const matches = await matchesQuestionRules(client, address, mode, universeId, ids, head.number)
	if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) return undefined
	return { rules: matches ? address : undefined }
}

export async function readSecurityPoolCreationCount(client: Pick<ReadClient, 'getStorageAt'>, owner: Address, blockNumber?: bigint) {
	const slot = keccak256(encodeAbiParameters(ownerAndCounter, [owner, securityPoolCreationCountSlot]))
	return BigInt(await client.getStorageAt({ address: getInfraContractAddresses().securityPoolFactory, slot, blockNumber }))
}

// Older drafts do not have a recorded counter. Locate the block whose state first shows the nonce spent.
// Search backwards exponentially so recent deployments do not depend on an archive RPC.
async function findNonceBlock(client: Pick<ReadClient, 'getTransactionCount'>, owner: Address, nonce: bigint, spentAt: bigint) {
	let high = spentAt
	let low = high
	for (let step = 1n; low > 0n; step *= 2n) {
		low = spentAt > step ? spentAt - step : 0n
		if ((await client.getTransactionCount({ address: owner, blockNumber: low })) <= nonce) break
		high = low
	}
	while (high - low > 1n) {
		const middle = (high + low) / 2n
		if ((await client.getTransactionCount({ address: owner, blockNumber: middle })) > nonce) high = middle
		else low = middle
	}
	return high
}

export class DeploymentHistoryUnavailableError extends Error {
	constructor(cause: unknown) {
		super(copy.historyUnavailable, { cause })
		this.name = 'DeploymentHistoryUnavailableError'
	}
}

async function readDeploymentBlockPoolCounts(client: Pick<ReadClient, 'getTransactionCount' | 'getStorageAt'>, owner: Address, nonce: bigint, confirmedHead: bigint) {
	try {
		const nonceBlock = await findNonceBlock(client, owner, nonce, confirmedHead)
		const first = nonceBlock === 0n ? 0n : await readSecurityPoolCreationCount(client, owner, nonceBlock - 1n)
		const end = await readSecurityPoolCreationCount(client, owner, nonceBlock)
		return { first, end }
	} catch (error) {
		if (/missing trie node|\bpruned\b|historical (?:state|data|history)(?: is)? (?:unavailable|not available)/i.test(providerFailureMessage(error))) throw new DeploymentHistoryUnavailableError(error)
		throw error
	}
}

function poolInitCodeHash(request: Pick<SecurityPoolTransaction, 'to' | 'data'>) {
	const addresses = getInfraContractAddresses()
	if (request.to?.toLowerCase() !== addresses.securityPoolFactory.toLowerCase()) return undefined
	const call = decodeFunctionData({ abi: poolDeploymentAbi, data: request.data })
	if (call.functionName !== 'deploySecurityPool') return undefined
	const [creationCode, configuration] = call.args
	const canonicalCode = getSecurityPoolCreationCode()
	if (typeof creationCode !== 'string' || creationCode.toLowerCase() !== canonicalCode.toLowerCase() || typeof configuration !== 'string' || !configuration.startsWith('0x')) return undefined
	const modules = encodeAbiParameters(poolModuleParameters, [
		addresses.securityPoolFactory,
		addresses.securityPoolCapitalLedgerDeployer,
		addresses.securityPoolCommitmentIndexDeployer,
		addresses.securityPoolCapitalFeeStreamsDeployer,
		addresses.securityPoolSettlementBookDeployer,
		addresses.securityPoolSettlementDeployer,
		addresses.securityPoolReporterLedgerDeployer,
		addresses.securityPoolForkCoordinatorDeployer,
		addresses.securityPoolServicesDeployer,
		addresses.securityPoolRepairAuctionDeployer,
	])
	return keccak256(concatHex([canonicalCode, modules, `0x${configuration.slice(2)}`]))
}

/** An absent result leaves the draft locked. An explicit empty result proves its nonce was consumed without a matching pool. */
export async function recoverSecurityPoolDeployment(client: ConfirmationClient & Pick<ReadClient, 'getStorageAt' | 'readContract'>, owner: Address, nonce: bigint, request: Pick<SecurityPoolTransaction, 'to' | 'data'>, initialFactoryCount?: bigint) {
	const head = await readSpentNonceHead(client, owner, nonce)
	if (head === undefined) return undefined
	const bytecodeHash = poolInitCodeHash(request)
	if (bytecodeHash === undefined) return undefined
	let first = initialFactoryCount
	let end = first === undefined ? undefined : await readSecurityPoolCreationCount(client, owner, head.number)
	if (first === undefined || end === undefined || end < first || end - first > 64n) {
		// Limit lookup to one block when the draft predates the counter checkpoint or many deployments followed it.
		const counts = await readDeploymentBlockPoolCounts(client, owner, nonce, head.number)
		first = counts.first
		end = counts.end
		if (end < first) return undefined
	}
	const factory = getInfraContractAddresses().securityPoolFactory
	let pool: Address | undefined
	for (let count = first; count < end; count += 1n) {
		const salt = keccak256(encodeAbiParameters(ownerAndCounter, [owner, count]))
		const candidate = getCreate2Address({ from: factory, salt, bytecodeHash })
		const registered = await client.readContract({ address: factory, abi: poolDeploymentAbi, functionName: 'isSecurityPool', args: [candidate], blockNumber: head.number })
		if (registered !== true) continue
		pool = candidate
		break
	}
	if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) return undefined
	return { pool }
}

import { type Abi, type AbiValue, type Address, type Hex, getAddress, isAddress, isHex, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { loadPortfolioVaultOperationIds, type PortfolioQueueLogReader } from './securityPoolPortfolioQueue.js'

/** A minimal adapter keeps snapshots usable by browser and server RPC clients. */
export type PortfolioReadClient = {
	getChainId(): Promise<number>
	getBlock(parameters?: { blockNumber?: bigint }): Promise<{ number?: bigint | undefined; hash?: Hex | undefined; timestamp: bigint }>
	readContract(parameters: { address: Address; abi: Abi; functionName: string; args?: readonly AbiValue[]; blockNumber: bigint }): Promise<unknown>
	getLogs?: PortfolioQueueLogReader
}
export type PortfolioQueuedOperation = {
	operationId: bigint
	operationType: bigint
	operator: Address
	receiverVault: Address
	targetVault: Address
	queuedAt: bigint
	validForSeconds: bigint
}
export type PortfolioPosition = {
	questionId: bigint
	universeId: bigint
	pool: Address
	registered: boolean
	repToken: Address
	coordinator: Address
	priceFeed: Address
	pendingReportCoordinator: Address
	backingUnits: bigint
	backingAttoRep: bigint
	commitmentAttoEth: bigint
	claimableFeesAttoEth: bigint
	openInterestAttoEth: bigint
	badDebtAttoEth: bigint
	disputeStakeAttoRep: bigint
	/** Ordinary dispute claims have not all settled; continuation residuals are burned. */
	ordinaryResidualPending: boolean
	poolHeldAttoRep: bigint
	totalBackingUnits: bigint
	poolCommitmentAttoEth: bigint
	settlementCollateralAttoEth: bigint
	securityMultiplierBps: bigint
	minimumDepositAttoRep: bigint
	systemState: bigint
	resolved: boolean
	questionEndTime: bigint
	forkTime: bigint
	price: bigint
	priceValid: boolean
	pendingReportId: bigint
	settlementTime: bigint
	queuedOperations: PortfolioQueuedOperation[]
	/** Includes unsolicited incoming liquidations; false keeps the aggregate history warning. */
	queuedOperationsComplete: boolean
	/** All active owner operations and potentially executable approved-receiver operations were read. */
	allocationOperationsComplete: boolean
}
type PortfolioBranch = { universeId: bigint; repToken: Address; idleAttoRep: bigint; forkTime: bigint; positions: PortfolioPosition[] }
export type PortfolioSnapshot = {
	chainId: number
	blockNumber: bigint
	blockHash: Hex
	timestamp: bigint
	portfolio: Address
	vault: Address
	owner: Address
	originUniverseId: bigint
	questions: bigint[]
	allocatedQuestionPage?: { start: bigint; count: bigint; total: bigint }
	branches: PortfolioBranch[]
	coverage: { complete: boolean; issues: string[]; scope: 'registered-and-explicit-pools'; registryComplete: boolean }
}

const abi = parseAbi([
	'function owner() view returns (address)',
	'function portfolio() view returns (address)',
	'function originUniverseId() view returns (uint248)',
	'function factory() view returns (address)',
	'function questionCount() view returns (uint256)',
	'function getQuestions(uint256,uint256) view returns (uint256[])',
	'function allocatedQuestionCount() view returns (uint256)',
	'function getAllocatedQuestions(uint256,uint256) view returns (uint256[])',
	'function questionOriginIds(uint256) view returns (bytes32)',
	'function getSecurityPool(bytes32,uint248) view returns (address)',
	'function getPortfolioOriginId(address,uint248,uint256,uint256,uint256) pure returns (bytes32)',
	'function priceFeed() view returns (address)',
	'function pendingCoordinator() view returns (address)',
	'function initialReportPriorityFeeAttoEthPerGas() view returns (uint256)',
	'function questionId() view returns (uint256)',
	'function universeId() view returns (uint248)',
	'function repToken() view returns (address)',
	'function zoltar() view returns (address)',
	'function questionData() view returns (address)',
	'function openOraclePriceCoordinator() view returns (address)',
	'function securityVaults(address) view returns (uint256,uint256,uint256,uint256)',
	'function getTotalPoolHeldAttoRep() view returns (uint256)',
	'function totalRepBackingUnits() view returns (uint256)',
	'function getVaultOpenInterestAttoEth(address) view returns (uint256)',
	'function vaultBadDebtAttoEth(address) view returns (uint256)',
	'function totalUnderwritingLimitAttoEth() view returns (uint256)',
	'function settlementCollateralAttoEth() view returns (uint256)',
	'function statoblastSecurityMultiplierBps() view returns (uint256)',
	'function minimumVaultRepDepositAttoRep() view returns (uint256)',
	'function systemState() view returns (uint8)',
	'function isEscalationResolved() view returns (bool)',
	'function escalationGame() view returns (address)',
	'function forkContinuation() view returns (bool)',
	'function totalDisputeStakedAttoRep() view returns (uint256)',
	'function disputeStakedRepByVaultAttoRep(address) view returns (uint256)',
	'function getQuestionEndDate(uint256) view returns (uint256)',
	'function getForkTime(uint248) view returns (uint256)',
	'function getRepToken(uint248) view returns (address)',
	'function balanceOf(address) view returns (uint256)',
	'function lastPrice() view returns (uint256)',
	'function isPriceValid() view returns (bool)',
	'function pendingReportId() view returns (uint256)',
	'function settlementTime() view returns (uint48)',
	'function getActiveStagedOperationCount() view returns (uint256)',
	'function stagedOperations(uint256) view returns (uint8,address,address,address,uint256,uint256,uint256,uint256,uint256,bytes32,uint256)',
	'function getActiveStagedOperations(uint256,uint256) view returns (uint256[], (uint8 operation,address operator,address receiverVault,address targetVault,uint256 operationValue,uint256 queuedAt,uint256 validForSeconds,uint256 snapshotTargetBackingUnits,uint256 snapshotTargetUnderwritingLimitAttoEth,bytes32 liquidationApprovalId,uint256 reservedLiquidationDebtAttoEth)[])',
])
function uint(value: unknown): bigint {
	if (typeof value !== 'bigint' || value < 0n) throw new Error('Invalid unsigned integer in portfolio snapshot.')
	return value
}
function address(value: unknown): Address {
	if (typeof value !== 'string' || !isAddress(value)) throw new Error('Invalid address in portfolio snapshot.')
	return getAddress(value)
}
function bytes32(value: unknown): Hex {
	if (typeof value !== 'string' || !isHex(value, { strict: true }) || value.length !== 66) throw new Error('Invalid origin id in portfolio snapshot.')
	return `0x${value.slice(2)}`
}
function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new Error('Invalid boolean in portfolio snapshot.')
	return value
}
function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error('Invalid tuple in portfolio snapshot.')
	return value
}
function operation(value: unknown, operationId: bigint): PortfolioQueuedOperation {
	if (value === null || typeof value !== 'object') throw new Error('Invalid operation in portfolio snapshot.')
	// Named ABI tuples are decoded as objects; unnamed fixtures may use arrays.
	if (Array.isArray(value)) return { operationId, operationType: uint(value[0]), operator: address(value[1]), receiverVault: address(value[2]), targetVault: address(value[3]), queuedAt: uint(value[5]), validForSeconds: uint(value[6]) }
	if (!('operation' in value && 'operator' in value && 'receiverVault' in value && 'targetVault' in value && 'queuedAt' in value && 'validForSeconds' in value)) throw new Error('Incomplete operation in portfolio snapshot.')
	return { operationId, operationType: uint(value.operation), operator: address(value.operator), receiverVault: address(value.receiverVault), targetVault: address(value.targetVault), queuedAt: uint(value.queuedAt), validForSeconds: uint(value.validForSeconds) }
}
function bound(value: number | undefined, fallback: number, name: string, minimum = 1) {
	const result = value ?? fallback
	if (!Number.isSafeInteger(result) || result < minimum || result > 4096) throw new Error(`${name} must be between ${minimum} and 4096.`)
	return result
}

/**
 * Read only the selected universes, registered questions and explicitly supplied extra pools.
 * This cannot discover arbitrary assets an owner obtained through generic vault calls.
 * Every call is pinned to one block, whose hash is checked again before returning.
 * @public Snapshot API exported by the securityPoolPortfolio package subpath.
 */
export async function loadPortfolioSnapshot(parameters: {
	client: PortfolioReadClient
	portfolio: Address
	vault: Address
	universeIds: readonly bigint[]
	questionIds?: readonly bigint[]
	additionalPools?: readonly Address[]
	maximumQuestions?: number
	allocatedQuestionStart?: bigint
	maximumAllocatedQuestions?: number
	maximumOperations?: number
}): Promise<PortfolioSnapshot> {
	const { client, portfolio, vault } = parameters
	if (!isAddress(portfolio) || !isAddress(vault) || vault === zeroAddress) throw new Error('Choose a portfolio and deployed vault.')
	if (parameters.universeIds.length === 0 || parameters.universeIds.length > 32) throw new Error('Choose one to 32 universes.')
	for (const universe of parameters.universeIds) if (universe < 0n || universe >= 1n << 248n) throw new Error('Universe id must fit uint248.')
	if ((parameters.additionalPools?.length ?? 0) > 64) throw new Error('Choose at most 64 additional pools.')
	const maximumQuestions = bound(parameters.maximumQuestions, 256, 'Question scan limit')
	const maximumAllocatedQuestions = bound(parameters.maximumAllocatedQuestions, maximumQuestions, 'Allocated question scan limit', 0)
	const allocatedQuestionStart = parameters.allocatedQuestionStart ?? 0n
	if (allocatedQuestionStart < 0n || allocatedQuestionStart >= 1n << 256n) throw new Error('Allocated question page start must fit uint256.')
	const maximumOperations = bound(parameters.maximumOperations, 256, 'Operation scan limit')
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	const blockNumber = block.number
	const blockHash = block.hash
	if (blockNumber === undefined || blockHash === undefined) throw new Error('Portfolio snapshot requires a mined block.')
	const read = (target: Address, functionName: string, args: readonly AbiValue[] = []) => client.readContract({ address: target, abi, functionName, args, blockNumber: blockNumber })
	const readUint = async (target: Address, functionName: string, args: readonly AbiValue[] = []) => uint(await read(target, functionName, args))
	const readAddress = async (target: Address, functionName: string, args: readonly AbiValue[] = []) => address(await read(target, functionName, args))
	const getLogs = client.getLogs?.bind(client)
	const [owner, vaultPortfolio, originUniverseId, factory, questionCount, securityMultiplier, initialReportPriorityFee] = await Promise.all([
		readAddress(vault, 'owner'),
		readAddress(vault, 'portfolio'),
		readUint(portfolio, 'originUniverseId'),
		readAddress(portfolio, 'factory'),
		readUint(portfolio, 'questionCount'),
		readUint(portfolio, 'statoblastSecurityMultiplierBps'),
		readUint(portfolio, 'initialReportPriorityFeeAttoEthPerGas'),
	])
	if (vaultPortfolio.toLowerCase() !== portfolio.toLowerCase()) throw new Error('Vault belongs to another portfolio.')
	const issues: string[] = []
	const explicitQuestions = parameters.questionIds
	if (explicitQuestions && explicitQuestions.length > maximumQuestions) throw new Error('Explicit question selection exceeds the question scan limit.')
	if (!explicitQuestions && questionCount > BigInt(maximumQuestions)) issues.push('Question scan limit reached; increase it or select explicit questions to read other positions.')
	const questions: bigint[] = explicitQuestions ? [...new Set(explicitQuestions)] : []
	for (const questionId of questions) if (questionId < 0n || questionId >= 1n << 256n) throw new Error('Question id must fit uint256.')
	const questionLimit = questionCount < BigInt(maximumQuestions) ? questionCount : BigInt(maximumQuestions)
	for (let start = 0n; !explicitQuestions && start < questionLimit; start += 64n) {
		const count = questionLimit - start < 64n ? questionLimit - start : 64n
		const page = array(await read(portfolio, 'getQuestions', [start, count])).map(uint)
		if (page.length !== Number(count)) throw new Error('Incomplete question page in portfolio snapshot.')
		questions.push(...page)
	}
	// Page owner allocations independently of explicit selections and registry growth.
	const allocatedCount = await readUint(vault, 'allocatedQuestionCount')
	const allocatedRemaining = allocatedCount > allocatedQuestionStart ? allocatedCount - allocatedQuestionStart : 0n
	const allocatedPageCount = allocatedRemaining < BigInt(maximumAllocatedQuestions) ? allocatedRemaining : BigInt(maximumAllocatedQuestions)
	const allocatedEnd = allocatedQuestionStart + allocatedPageCount
	// Structured page metadata describes omitted positions; issues hold independent read limitations.
	const allocatedQuestionsComplete = allocatedQuestionStart === 0n && allocatedPageCount === allocatedCount
	for (let start = allocatedQuestionStart; start < allocatedEnd; start += 64n) {
		const count = allocatedEnd - start < 64n ? allocatedEnd - start : 64n
		const page = array(await read(vault, 'getAllocatedQuestions', [start, count])).map(uint)
		if (page.length !== Number(count)) throw new Error('Incomplete allocated question page in portfolio snapshot.')
		for (const questionId of page) if (!questions.includes(questionId)) questions.push(questionId)
	}
	const readOrigin = async (questionId: bigint) => {
		if (questionId < 0n || questionId >= 1n << 256n) throw new Error('Question id must fit uint256.')
		const originId = bytes32(await read(portfolio, 'questionOriginIds', [questionId]))
		if (originId === `0x${'0'.repeat(64)}`) throw new Error(`Question ${questionId} is not registered in this portfolio.`)
		const expectedOriginId = bytes32(await read(factory, 'getPortfolioOriginId', [portfolio, originUniverseId, questionId, securityMultiplier, initialReportPriorityFee]))
		if (originId.toLowerCase() !== expectedOriginId.toLowerCase()) throw new Error('Portfolio question origin mismatch.')
		return { questionId, originId }
	}
	const origins = await Promise.all(questions.map(readOrigin))
	let first = origins[0]
	if (first === undefined) {
		// An empty position page must still expose account balances without a registry scan.
		const seed = array(await read(portfolio, 'getQuestions', [0n, 1n])).map(uint)
		const questionId = seed[0]
		if (seed.length !== 1 || questionId === undefined) throw new Error('Portfolio has no registered origin pool.')
		first = await readOrigin(questionId)
	}
	const originPool = await readAddress(factory, 'getSecurityPool', [first.originId, originUniverseId])
	if (originPool === zeroAddress) throw new Error('Portfolio origin pool is missing.')
	const zoltar = await readAddress(originPool, 'zoltar')
	const branches: PortfolioBranch[] = []
	for (const universeId of new Set(parameters.universeIds)) {
		const repToken = await readAddress(zoltar, 'getRepToken', [universeId])
		if (repToken === zeroAddress) {
			issues.push(`Universe ${universeId} has no REP token.`)
			continue
		}
		const [idleAttoRep, forkTime] = await Promise.all([readUint(repToken, 'balanceOf', [vault]), readUint(zoltar, 'getForkTime', [universeId])])
		branches.push({ universeId, repToken, idleAttoRep, forkTime, positions: [] })
	}
	const references = new Map<string, { pool: Address; registered: boolean; questionId?: bigint; universeId?: bigint }>()
	for (const branch of branches) {
		for (const origin of origins) {
			const pool = await readAddress(factory, 'getSecurityPool', [origin.originId, branch.universeId])
			if (pool !== zeroAddress) references.set(pool.toLowerCase(), { pool, registered: true, questionId: origin.questionId, universeId: branch.universeId })
		}
	}
	for (const pool of parameters.additionalPools ?? []) {
		if (!isAddress(pool) || pool === zeroAddress) throw new Error('Invalid additional pool address.')
		if (!references.has(pool.toLowerCase())) references.set(pool.toLowerCase(), { pool, registered: false })
	}
	for (const reference of references.values()) {
		const { pool, registered } = reference
		const [questionId, universeId, repToken, coordinator, questionData, game] = await Promise.all([readUint(pool, 'questionId'), readUint(pool, 'universeId'), readAddress(pool, 'repToken'), readAddress(pool, 'openOraclePriceCoordinator'), readAddress(pool, 'questionData'), readAddress(pool, 'escalationGame')])
		if (registered && (reference.questionId !== questionId || reference.universeId !== universeId)) throw new Error('Canonical pool identity mismatch.')
		const branch = branches.find(candidate => candidate.universeId === universeId && candidate.repToken.toLowerCase() === repToken.toLowerCase())
		if (!branch) {
			issues.push(`Pool ${pool} is outside the selected universe/token branches.`)
			continue
		}
		const [vaultTuple, poolHeldAttoRep, totalBackingUnits, commitmentTotal, settlementCollateralAttoEth, openInterestAttoEth, badDebtAttoEth, securityMultiplierBps, minimumDepositAttoRep, systemState, resolved, questionEndTime, disputeStakeAttoRep, price, priceValid, pendingReportId, settlementTime, operationCount] =
			await Promise.all([
				read(pool, 'securityVaults', [vault]).then(array),
				readUint(pool, 'getTotalPoolHeldAttoRep'),
				readUint(pool, 'totalRepBackingUnits'),
				readUint(pool, 'totalUnderwritingLimitAttoEth'),
				readUint(pool, 'settlementCollateralAttoEth'),
				readUint(pool, 'getVaultOpenInterestAttoEth', [vault]),
				readUint(pool, 'vaultBadDebtAttoEth', [vault]),
				readUint(pool, 'statoblastSecurityMultiplierBps'),
				readUint(pool, 'minimumVaultRepDepositAttoRep'),
				readUint(pool, 'systemState'),
				read(pool, 'isEscalationResolved').then(boolean),
				readUint(questionData, 'getQuestionEndDate', [questionId]),
				game === zeroAddress ? Promise.resolve(0n) : readUint(game, 'disputeStakedRepByVaultAttoRep', [vault]),
				readUint(coordinator, 'lastPrice'),
				read(coordinator, 'isPriceValid').then(boolean),
				readUint(coordinator, 'pendingReportId'),
				readUint(coordinator, 'settlementTime'),
				readUint(coordinator, 'getActiveStagedOperationCount'),
			])
		const priceFeed = await readAddress(coordinator, 'priceFeed')
		let pendingReportCoordinator = zeroAddress
		if (pendingReportId !== 0n) pendingReportCoordinator = priceFeed.toLowerCase() === coordinator.toLowerCase() ? coordinator : await readAddress(priceFeed, 'pendingCoordinator')
		let ordinaryResidualPending = false
		if (game !== zeroAddress) {
			const [continuation, totalDisputeStaked] = await Promise.all([read(game, 'forkContinuation').then(boolean), readUint(game, 'totalDisputeStakedAttoRep')])
			ordinaryResidualPending = !continuation && totalDisputeStaked > 0n
		}
		let queuedOperations: PortfolioQueuedOperation[] = []
		const queuedOperationsComplete = operationCount <= BigInt(maximumOperations)
		let allocationOperationsComplete = queuedOperationsComplete
		if (!queuedOperationsComplete && getLogs) {
			try {
				const operationIds = await loadPortfolioVaultOperationIds({ getLogs, getBlock: parameters => client.getBlock(parameters), coordinator, vault, blockNumber, timestamp: block.timestamp, settlementTime })
				const verifiedOperations: PortfolioQueuedOperation[] = []
				for (let start = 0; start < operationIds.length; start += 64) {
					const candidates = await Promise.all(operationIds.slice(start, start + 64).map(async id => operation(await read(coordinator, 'stagedOperations', [id]), id)))
					for (const queued of candidates) {
						if (queued.operator === zeroAddress) continue
						if (![queued.operator, queued.receiverVault].some(account => account.toLowerCase() === vault.toLowerCase())) throw new Error('Vault operation history does not match current queue ownership.')
						verifiedOperations.push(queued)
					}
				}
				queuedOperations = verifiedOperations
				allocationOperationsComplete = true
			} catch (failure) {
				issues.push(`Vault operation history could not be verified for pool ${pool}; retry before allocating to this question. Reason: ${errorMessage(failure)}`)
			}
		}
		if (!queuedOperationsComplete) issues.push(`Operation scan limit reached for pool ${pool}; pending exposure may be missing.`)
		const limit = operationCount < BigInt(maximumOperations) ? operationCount : BigInt(maximumOperations)
		for (let start = 0n; start < limit; start += 64n) {
			const count = limit - start < 64n ? limit - start : 64n
			const page = array(await read(coordinator, 'getActiveStagedOperations', [start, count]))
			const ids = array(page[0]).map(uint)
			const operations = array(page[1])
			if (ids.length !== Number(count) || operations.length !== ids.length) throw new Error('Incomplete operation page in portfolio snapshot.')
			for (let index = 0; index < ids.length; index++) {
				const id = ids[index]
				if (id === undefined) throw new Error('Missing operation id.')
				const queued = operation(operations[index], id)
				if ([queued.operator, queued.receiverVault, queued.targetVault].some(account => account.toLowerCase() === vault.toLowerCase()) && !queuedOperations.some(existing => existing.operationId === id)) queuedOperations.push(queued)
			}
		}
		const backingUnits = uint(vaultTuple[0])
		branch.positions.push({
			questionId,
			universeId,
			pool,
			registered,
			repToken,
			coordinator,
			priceFeed,
			pendingReportCoordinator,
			backingUnits,
			backingAttoRep: totalBackingUnits === 0n ? 0n : (backingUnits * poolHeldAttoRep) / totalBackingUnits,
			commitmentAttoEth: uint(vaultTuple[1]),
			claimableFeesAttoEth: uint(vaultTuple[2]),
			openInterestAttoEth,
			badDebtAttoEth,
			disputeStakeAttoRep,
			ordinaryResidualPending,
			poolHeldAttoRep,
			totalBackingUnits,
			poolCommitmentAttoEth: commitmentTotal,
			settlementCollateralAttoEth,
			securityMultiplierBps,
			minimumDepositAttoRep,
			systemState,
			resolved,
			questionEndTime,
			forkTime: branch.forkTime,
			price,
			priceValid,
			pendingReportId,
			settlementTime,
			queuedOperations,
			queuedOperationsComplete,
			allocationOperationsComplete,
		})
	}
	const [verified, verifiedChainId] = await Promise.all([client.getBlock({ blockNumber: blockNumber }), client.getChainId()])
	if (verified.hash !== blockHash || verifiedChainId !== chainId) throw new Error('Chain changed while reading portfolio; refresh before planning.')
	return {
		chainId,
		blockNumber: blockNumber,
		blockHash: blockHash,
		timestamp: block.timestamp,
		portfolio,
		vault,
		owner,
		originUniverseId,
		questions,
		allocatedQuestionPage: { start: allocatedQuestionStart, count: allocatedPageCount, total: allocatedCount },
		branches,
		coverage: { complete: allocatedQuestionsComplete && issues.length === 0, issues, scope: 'registered-and-explicit-pools', registryComplete: BigInt(questions.length) === questionCount },
	}
}

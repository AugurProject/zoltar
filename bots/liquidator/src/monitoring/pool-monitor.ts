import { getAddress, zeroAddress, type Address, type Chain, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '#config/settings'
import { coordinatorAbi, deploySecurityPoolEvent, erc20Abi, escalationGameAbi, securityPoolAbi, securityPoolFactoryAbi, securityPoolForkerAbi, vaultAccountingCheckpointEvent, zoltarAbi } from '#contracts/abi'
import { isPoolExecutionEligible } from '#core/fork-migration'
import { evaluateCandidate, repForBackingUnits, sortCandidates, type VaultPosition } from '#core/strategy'
import { hasStagedLiquidation } from '#core/staged-operations'
import type { PoolObservation, StagedOperationObservation, UniverseObservation } from '#state/operator-state'
import { createVaultStateIndex, refreshVaultStateIndex, type VaultStateIndex } from './vault-state-index.ts'
import { discoverRelevantDeployments } from './relevant-deployments.ts'

type ReadClient = PublicClient<Transport, Chain>
const MULTICALL3_ADDRESS = getAddress('0xB657B12CD9d80421DBC2bc70c43d6b2ff9409108')

type PoolDeployment = {
	settlementCollateralAttoEth: bigint
	currentRetentionRate: bigint
	initialReportPriorityFeeAttoEthPerGas: bigint
	parent: Address
	priceOracleManagerAndOperatorQueuer: Address
	questionId: bigint
	securityPool: Address
	statoblastSecurityMultiplierBps: bigint
	universeId: bigint
}

export type PoolMonitorIndex = {
	vaultsByPool: Map<string, VaultStateIndex<VaultPosition>>
}

export function createPoolMonitorIndex(): PoolMonitorIndex {
	return { vaultsByPool: new Map() }
}

function sameAddress(left: Address, right: Address) {
	return left.toLowerCase() === right.toLowerCase()
}

export function candidateScreeningPrice(lastPrice: bigint, fallbackPrice: bigint) {
	return lastPrice > 0n ? lastPrice : fallbackPrice
}

export function validatePoolUniverseRep(pool: Pick<PoolObservation, 'address' | 'repToken' | 'universeId'>, universes: readonly UniverseObservation[]) {
	const universe = universes.find(candidate => candidate.id === pool.universeId)
	if (universe === undefined) throw new Error(`Pool ${pool.address} belongs to unknown universe ${pool.universeId.toString()}`)
	if (!sameAddress(pool.repToken, universe.repToken)) {
		throw new Error(`Pool ${pool.address} REP token ${pool.repToken} does not match universe ${pool.universeId.toString()} REP ${universe.repToken}`)
	}
}

function emptyVault(address: Address): VaultPosition {
	return {
		address,
		capacityOwnershipAttoRep: 0n,
		badDebtAttoEth: 0n,
		openInterestAttoEth: 0n,
		backingUnits: 0n,
		vaultAttoRepBacking: 0n,
		claimableFeesAttoEth: 0n,
		disputeStakedAttoRep: 0n,
	}
}

async function loadUniverses(client: ReadClient, settings: OperatorSettings) {
	const root = await client.readContract({
		abi: zoltarAbi,
		address: settings.deployment.zoltar,
		args: [0n],
		functionName: 'universes',
	})
	const universes: UniverseObservation[] = [
		{
			approved: settings.approvedUniverses.includes(0n),
			forkQuestionId: root.forkQuestionId,
			forkTime: root.forkTime,
			id: 0n,
			outcomeIndex: undefined,
			parentId: undefined,
			repToken: getAddress(root.reputationToken),
		},
	]
	const seen = new Set(['0'])
	for (let universeIndex = 0; universeIndex < universes.length; universeIndex += 1) {
		const universe = universes[universeIndex]
		if (universe === undefined) throw new Error('Universe traversal lost its current entry')
		for (let start = 0n; ; start += 100n) {
			const [outcomeIndexes, childUniverseIds, children] = await client.readContract({
				abi: zoltarAbi,
				address: settings.deployment.zoltar,
				args: [universe.id, start, 100n],
				functionName: 'getDeployedChildUniverses',
			})
			if (outcomeIndexes.length !== childUniverseIds.length || childUniverseIds.length !== children.length) {
				throw new Error(`Zoltar returned mismatched children for universe ${universe.id.toString()}`)
			}
			for (const [index, childId] of childUniverseIds.entries()) {
				const child = children[index]
				const outcomeIndex = outcomeIndexes[index]
				if (child === undefined || outcomeIndex === undefined) throw new Error('Zoltar returned an incomplete child universe')
				const key = childId.toString()
				if (seen.has(key)) throw new Error(`Zoltar universe ${key} appears more than once in the universe tree`)
				seen.add(key)
				universes.push({
					approved: settings.approvedUniverses.includes(childId),
					forkQuestionId: child.forkQuestionId,
					forkTime: child.forkTime,
					id: childId,
					outcomeIndex,
					parentId: universe.id,
					repToken: getAddress(child.reputationToken),
				})
			}
			if (children.length < 100) break
		}
	}
	return universes
}

async function loadVault(client: ReadClient, pool: Address, escalationGame: Address, vault: Address, totalAttoRep: bigint, denominator: bigint, blockNumber?: bigint): Promise<VaultPosition> {
	const [raw, openInterestAttoEth, badDebtAttoEth, disputeStakedAttoRep] = await Promise.all([
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'securityVaults' }),
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'getVaultOpenInterestAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'vaultBadDebtAttoEth' }),
		escalationGame === zeroAddress ? 0n : client.readContract({ abi: escalationGameAbi, address: escalationGame, args: [vault], blockNumber, functionName: 'disputeStakedRepByVaultAttoRep' }),
	])
	const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = raw
	return {
		address: vault,
		badDebtAttoEth,
		capacityOwnershipAttoRep,
		openInterestAttoEth,
		backingUnits: repBackingUnits,
		vaultAttoRepBacking: repForBackingUnits(repBackingUnits, totalAttoRep, denominator),
		claimableFeesAttoEth,
		disputeStakedAttoRep,
	}
}

function requireBigint(value: unknown, label: string) {
	if (typeof value !== 'bigint') throw new Error(`Security pool returned invalid ${label}`)
	return value
}

function requireVaultPositionTuple(value: unknown) {
	if (!Array.isArray(value)) throw new Error('Security pool returned invalid vault state')
	return [requireBigint(value[0], 'vault backing units'), requireBigint(value[1], 'vault capacity ownership'), requireBigint(value[2], 'vault claimable fees')] as const
}

async function loadVaultPage(client: ReadClient, pool: Address, escalationGame: Address, vaultAddresses: readonly Address[], totalAttoRep: bigint, denominator: bigint, blockNumber: bigint) {
	const [rawVaults, openInterest, badDebt, disputeStake] = await Promise.all([
		client.multicall({ allowFailure: false, blockNumber, contracts: vaultAddresses.map(vault => ({ abi: securityPoolAbi, address: pool, args: [vault], functionName: 'securityVaults' as const })), multicallAddress: MULTICALL3_ADDRESS }),
		client.multicall({ allowFailure: false, blockNumber, contracts: vaultAddresses.map(vault => ({ abi: securityPoolAbi, address: pool, args: [vault], functionName: 'getVaultOpenInterestAttoEth' as const })), multicallAddress: MULTICALL3_ADDRESS }),
		client.multicall({ allowFailure: false, blockNumber, contracts: vaultAddresses.map(vault => ({ abi: securityPoolAbi, address: pool, args: [vault], functionName: 'vaultBadDebtAttoEth' as const })), multicallAddress: MULTICALL3_ADDRESS }),
		escalationGame === zeroAddress
			? vaultAddresses.map(() => 0n)
			: client.multicall({ allowFailure: false, blockNumber, contracts: vaultAddresses.map(vault => ({ abi: escalationGameAbi, address: escalationGame, args: [vault], functionName: 'disputeStakedRepByVaultAttoRep' as const })), multicallAddress: MULTICALL3_ADDRESS }),
	])
	return vaultAddresses.map((address, index) => {
		const raw = rawVaults[index]
		const openInterestAttoEth = openInterest[index]
		const badDebtAttoEth = badDebt[index]
		const disputeStakedAttoRep = disputeStake[index]
		if (raw === undefined || openInterestAttoEth === undefined || badDebtAttoEth === undefined || disputeStakedAttoRep === undefined) throw new Error('Security pool returned incomplete vault state')
		const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = requireVaultPositionTuple(raw)
		return {
			address,
			badDebtAttoEth: requireBigint(badDebtAttoEth, 'vault bad debt'),
			capacityOwnershipAttoRep,
			openInterestAttoEth: requireBigint(openInterestAttoEth, 'vault open interest'),
			backingUnits: repBackingUnits,
			vaultAttoRepBacking: repForBackingUnits(repBackingUnits, totalAttoRep, denominator),
			claimableFeesAttoEth,
			disputeStakedAttoRep: requireBigint(disputeStakedAttoRep, 'vault dispute stake'),
		}
	})
}

export function hasVaultRep(vault: VaultPosition) {
	return vault.backingUnits > 0n || vault.disputeStakedAttoRep > 0n
}

async function loadCurrentVaults(client: ReadClient, index: VaultStateIndex<VaultPosition>, pool: Address, escalationGame: Address, knownVaultCount: bigint, totalAttoRep: bigint, denominator: bigint, block: Readonly<{ hash: `0x${string}`; number: bigint }>) {
	return await refreshVaultStateIndex(index, {
		block,
		hasRep: hasVaultRep,
		knownVaultCount,
		loadChangedVaultAddresses: async (fromBlock, toBlock) => {
			const logs = await client.getLogs({ address: pool, event: vaultAccountingCheckpointEvent, fromBlock, toBlock })
			return logs.map(log => {
				const vault = log.args?.vault
				if (vault === undefined) throw new Error('Vault accounting checkpoint is missing its vault address')
				return getAddress(vault)
			})
		},
		loadPositions: async vaults => await loadVaultPage(client, pool, escalationGame, vaults, totalAttoRep, denominator, block.number),
		loadRegistryRange: async (start, count) => {
			const page = await client.readContract({ abi: securityPoolAbi, address: pool, args: [start, count], blockNumber: block.number, functionName: 'getVaults' })
			return page.map(address => getAddress(address))
		},
		readCanonicalBlockHash: async blockNumber => (await client.getBlock({ blockNumber })).hash,
	})
}

async function loadPool(
	client: ReadClient,
	settings: OperatorSettings,
	deployment: PoolDeployment,
	wallet: Address | undefined,
	monitorIndex: PoolMonitorIndex,
) {
	const block = await client.getBlock()
	if (block.hash === undefined || block.number === undefined) throw new Error('Security pool scan block is missing canonical identity')
	const blockNumber = block.number
	const address = getAddress(deployment.securityPool)
	const manager = getAddress(deployment.priceOracleManagerAndOperatorQueuer)
	const [
		knownVaultCount,
		settlementCollateralAttoEth,
		currentRetentionRate,
		denominator,
		escalationGame,
		isPriceValid,
		lastPrice,
		lastSettlementTimestamp,
		minLiquidationPriceDistanceBps,
		minimumSecurityBondDebtAttoEth,
		minimumToken1ReportAttoEth,
		minimumVaultRepDepositAttoRep,
		poolAccountingSnapshot,
		pendingReportId,
		pendingReportSponsor,
		repToken,
		requestPriceCostAttoEth,
		securityPoolForker,
		systemState,
		totalCapacityOwnershipAttoRep,
		totalAttoRep,
	] = await Promise.all([
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'getVaultCount' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'settlementCollateralAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'currentRetentionRate' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'totalRepBackingUnits' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'escalationGame' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'isPriceValid' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'lastPrice' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'lastSettlementTimestamp' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'minLiquidationPriceDistanceBps' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'minimumSecurityBondDebtAttoEth' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'minimumToken1ReportAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'minimumVaultRepDepositAttoRep' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'getPoolAccountingSnapshot' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'pendingReportId' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'pendingReportSponsor' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'repToken' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'getRequestPriceCostAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'securityPoolForker' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'systemState' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'totalCapacityOwnershipAttoRep' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'getTotalPoolHeldAttoRep' }),
	])
	const [forkData, forkActivationTime] = await Promise.all([
		client.readContract({ abi: securityPoolForkerAbi, address: securityPoolForker, args: [address], functionName: 'forkData' }),
		client.readContract({ abi: securityPoolForkerAbi, address: securityPoolForker, args: [address], functionName: 'getForkActivationTime' }),
	])
	const forkOutcomeIndex = deployment.parent === zeroAddress ? undefined : forkData[10]
	const normalizedEscalationGame = getAddress(escalationGame)
	let vaultIndex = monitorIndex.vaultsByPool.get(address.toLowerCase())
	if (vaultIndex === undefined) {
		vaultIndex = createVaultStateIndex<VaultPosition>()
		monitorIndex.vaultsByPool.set(address.toLowerCase(), vaultIndex)
	}
	const vaults = await loadCurrentVaults(client, vaultIndex, address, normalizedEscalationGame, knownVaultCount, totalAttoRep, denominator, { hash: block.hash, number: blockNumber })
	const [stagedOperationCount, pendingSettlementOperationIds] = await Promise.all([
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'getActiveStagedOperationCount' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'getPendingSettlementOperationIds' }),
	])
	const stagedOperations: StagedOperationObservation[] = []
	for (let start = 0n; start < stagedOperationCount; start += 100n) {
		const pageCount = stagedOperationCount - start < 100n ? stagedOperationCount - start : 100n
		const [ids, operations] = await client.readContract({ abi: coordinatorAbi, address: manager, args: [start, pageCount], functionName: 'getActiveStagedOperations' })
		for (const [index, operation] of operations.entries()) {
			const id = ids[index]
			if (id === undefined) throw new Error('Coordinator returned mismatched staged operation arrays')
			stagedOperations.push({
				operationAmountAttoRepOrAttoEth: operation.operationAmountAttoRepOrAttoEth,
				id,
				liquidationApprovalId: operation.liquidationApprovalId,
				isPendingSettlement: pendingSettlementOperationIds.includes(id),
				operation: operation.operation,
				operator: getAddress(operation.operator),
				queuedAt: operation.queuedAt,
				receiverVault: getAddress(operation.receiverVault),
				reservedLiquidationDebtAttoEth: operation.reservedLiquidationDebtAttoEth,
				snapshotTotalRepBackingUnits: operation.snapshotTotalRepBackingUnits,
				snapshotTargetCapacityOwnershipAttoRep: operation.snapshotTargetCapacityOwnershipAttoRep,
				snapshotTargetDisputeStakedAttoRep: operation.snapshotTargetDisputeStakedAttoRep,
				snapshotTargetOpenInterestAttoEth: operation.snapshotTargetOpenInterestAttoEth,
				snapshotTargetBackingUnits: operation.snapshotTargetBackingUnits,
				snapshotTotalPoolHeldAttoRep: operation.snapshotTotalPoolHeldAttoRep,
				targetVault: getAddress(operation.targetVault),
				validForSeconds: operation.validForSeconds,
			})
		}
	}
	const botVault = wallet === undefined ? emptyVault(zeroAddress) : (vaults.find(vault => sameAddress(vault.address, wallet)) ?? (await loadVault(client, address, normalizedEscalationGame, wallet, totalAttoRep, denominator, blockNumber)))
	const selected = settings.selectedPools.some(pool => sameAddress(pool, address))
	const approvedUniverse = settings.approvedUniverses.includes(deployment.universeId)
	const riskContext = {
		address,
		denominator,
		feeEligibleCapacityOwnershipAttoRep: poolAccountingSnapshot.feeEligibleCapacityOwnershipAttoRep,
		manager,
		minLiquidationPriceDistanceBps,
		minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep,
		multiplierBps: deployment.statoblastSecurityMultiplierBps,
		price: candidateScreeningPrice(lastPrice, settings.strategy.fallbackRepPerEthPrice),
		settlementCollateralAttoEth: poolAccountingSnapshot.settlementCollateralAttoEth,
		totalAttoRep,
		totalCapacityOwnershipAttoRep,
	}
	const candidates = !isPoolExecutionEligible({ approvedUniverse, selected, systemState })
		? []
		: sortCandidates(
				vaults.flatMap(target => {
					if (wallet !== undefined && sameAddress(target.address, wallet)) return []
					if (wallet !== undefined && hasStagedLiquidation(stagedOperations, wallet, target.address)) return []
					const candidate = evaluateCandidate(riskContext, target, botVault, settings.strategy)
					return candidate === undefined ? [] : [candidate]
				}),
				settings.strategy.candidatePriority,
			)
	return {
		knownVaultCount,
		address,
		approvedUniverse,
		botVault,
		candidates,
		settlementCollateralAttoEth,
		currentRetentionRate,
		forkActivationTime,
		forkOutcomeIndex,
		initialReportPriorityFeeAttoEthPerGas: deployment.initialReportPriorityFeeAttoEthPerGas,
		isPriceValid,
		lastPrice,
		lastSettlementTimestamp,
		manager,
		minLiquidationPriceDistanceBps,
		minimumSecurityBondDebtAttoEth,
		minimumToken1ReportAttoEth,
		minimumVaultRepDepositAttoRep,
		multiplierBps: deployment.statoblastSecurityMultiplierBps,
		parent: getAddress(deployment.parent),
		parentUniverseId: undefined,
		pendingReportId,
		pendingReportSponsor: getAddress(pendingReportSponsor),
		questionId: deployment.questionId,
		repToken: getAddress(repToken),
		requestPriceCostAttoEth,
		selected,
		securityPoolForker: getAddress(securityPoolForker),
		stagedOperations,
		systemState,
		totalCapacityOwnershipAttoRep,
		totalAttoRep,
		universeId: deployment.universeId,
		vaults,
	} satisfies PoolObservation
}

function deploymentFromLog(log: Readonly<{ args?: unknown }>): PoolDeployment {
	const args = log.args
	if (typeof args !== 'object' || args === null) throw new Error('SecurityPool deployment event is missing its arguments')
	const securityPool = Reflect.get(args, 'securityPool')
	const parent = Reflect.get(args, 'parent')
	const manager = Reflect.get(args, 'priceOracleManagerAndOperatorQueuer')
	const universeId = Reflect.get(args, 'universeId')
	const questionId = Reflect.get(args, 'questionId')
	const multiplier = Reflect.get(args, 'statoblastSecurityMultiplierBps')
	const priorityFee = Reflect.get(args, 'initialReportPriorityFeeAttoEthPerGas')
	const retentionRate = Reflect.get(args, 'currentRetentionRate')
	const settlementCollateral = Reflect.get(args, 'settlementCollateralAttoEth')
	if (
		typeof securityPool !== 'string' ||
		typeof parent !== 'string' ||
		typeof manager !== 'string' ||
		typeof universeId !== 'bigint' ||
		typeof questionId !== 'bigint' ||
		typeof multiplier !== 'bigint' ||
		typeof priorityFee !== 'bigint' ||
		typeof retentionRate !== 'bigint' ||
		typeof settlementCollateral !== 'bigint'
	) {
		throw new Error('SecurityPool deployment event is incomplete')
	}
	return {
		currentRetentionRate: retentionRate,
		initialReportPriorityFeeAttoEthPerGas: priorityFee,
		parent: getAddress(parent),
		priceOracleManagerAndOperatorQueuer: getAddress(manager),
		questionId,
		securityPool: getAddress(securityPool),
		settlementCollateralAttoEth: settlementCollateral,
		statoblastSecurityMultiplierBps: multiplier,
		universeId,
	}
}

async function loadRelevantPoolDeployments(client: ReadClient, settings: OperatorSettings, blockNumber: bigint) {
	const loadDeployments = async (args: Readonly<{ parent?: Address; securityPool?: Address }>) =>
		(
			await client.getLogs({
				address: settings.deployment.securityPoolFactory,
				args,
				event: deploySecurityPoolEvent,
				fromBlock: 0n,
				toBlock: blockNumber,
			})
		).map(deploymentFromLog)
	return await discoverRelevantDeployments({
		desiredPools: settings.desiredPools,
		loadDeploymentsForParent: async parent => await loadDeployments({ parent }),
		loadDeploymentsForPool: async securityPool => await loadDeployments({ securityPool }),
		resolveDesiredPool: async desired => {
			const originId = await client.readContract({
				abi: securityPoolFactoryAbi,
				address: settings.deployment.securityPoolFactory,
				args: [desired.universeId, desired.questionId, desired.statoblastSecurityMultiplierBps, desired.initialReportPriorityFeeAttoEthPerGas],
				blockNumber,
				functionName: 'getOriginId',
			})
			return getAddress(
				await client.readContract({
					abi: securityPoolFactoryAbi,
					address: settings.deployment.securityPoolFactory,
					args: [originId, desired.universeId],
					blockNumber,
					functionName: 'getSecurityPool',
				}),
			)
		},
		selectedPools: settings.selectedPools,
	})
}

export async function scanPools(client: ReadClient, settings: OperatorSettings, wallet: Address | undefined, monitorIndex: PoolMonitorIndex = createPoolMonitorIndex()) {
	const universes = await loadUniverses(client, settings)
	const blockNumber = await client.getBlockNumber()
	const deployments = await loadRelevantPoolDeployments(client, settings, blockNumber)
	const loadedPools: PoolObservation[] = []
	for (const deployment of deployments) {
		const pool = await loadPool(client, settings, deployment, wallet, monitorIndex)
		validatePoolUniverseRep(pool, universes)
		loadedPools.push(pool)
	}
	const poolsByAddress = new Map(loadedPools.map(pool => [pool.address.toLowerCase(), pool]))
	const pools = loadedPools.map(pool => ({
		...pool,
		parentUniverseId: poolsByAddress.get(pool.parent.toLowerCase())?.universeId,
	}))
	const walletRepByToken = new Map<string, bigint>()
	if (wallet !== undefined) {
		for (const token of [...new Map(pools.map(pool => [pool.repToken.toLowerCase(), pool.repToken])).values()]) {
			walletRepByToken.set(
				token.toLowerCase(),
				await client.readContract({
					abi: erc20Abi,
					address: token,
					args: [wallet],
					functionName: 'balanceOf',
				}),
			)
		}
	}
	return { pools, universes, walletRepByToken }
}

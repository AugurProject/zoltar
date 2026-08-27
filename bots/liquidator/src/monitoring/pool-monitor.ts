import { getAddress, zeroAddress, type Address, type Chain, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'
import { fetchLogsWithAdaptiveRanges } from '@zoltar/bot-shared/monitoring/block-sync'
import type { OperatorSettings } from '#config/settings'
import { coordinatorAbi, deploySecurityPoolEvent, erc20Abi, escalationGameAbi, securityPoolAbi, securityPoolFactoryAbi, securityPoolForkerAbi, truthAuctionHaircutAppliedEvent, vaultAccountingCheckpointEvent, vaultEscrowUpdatedEvent, zoltarAbi } from '#contracts/abi'
import { isPoolExecutionEligible } from '#core/fork-migration'
import { evaluateCandidate, repForBackingUnits, sortCandidates, type VaultPosition } from '#core/strategy'
import { hasStagedLiquidation } from '#core/staged-operations'
import type { PoolObservation, StagedOperationObservation, UniverseObservation } from '#state/operator-state'
import { createVaultStateIndex, refreshVaultStateIndex, type VaultStateIndex } from './vault-state-index.ts'
import { discoverRelevantDeployments } from './relevant-deployments.ts'

type ReadClient = PublicClient<Transport, Chain>
const MULTICALL3_ADDRESS = getAddress('0xB657B12CD9d80421DBC2bc70c43d6b2ff9409108')
const MAXIMUM_DEPLOYMENT_LOG_RANGE = 10_000n
const MAXIMUM_VAULT_CHANGE_LOG_RANGE = 10_000n

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
	operatorVaultsByPool: Map<string, VaultPosition>
	vaultsByPool: Map<string, VaultStateIndex<VaultPosition>>
}

export function createPoolMonitorIndex(): PoolMonitorIndex {
	return { operatorVaultsByPool: new Map(), vaultsByPool: new Map() }
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

function requireBigint(value: unknown, label: string) {
	if (typeof value !== 'bigint') throw new Error(`Security pool returned invalid ${label}`)
	return value
}

function requireVaultPositionTuple(value: unknown) {
	if (!Array.isArray(value)) throw new Error('Security pool returned invalid vault state')
	return [requireBigint(value[0], 'vault backing units'), requireBigint(value[1], 'vault capacity ownership'), requireBigint(value[2], 'vault claimable fees')] as const
}

async function loadVaultPage(client: ReadClient, pool: Address, escalationGame: Address, vaultAddresses: readonly Address[], blockNumber: bigint) {
	const [rawVaults, badDebt, disputeStake] = await Promise.all([
		client.multicall({ allowFailure: false, blockNumber, contracts: vaultAddresses.map(vault => ({ abi: securityPoolAbi, address: pool, args: [vault], functionName: 'securityVaults' as const })), multicallAddress: MULTICALL3_ADDRESS }),
		client.multicall({ allowFailure: false, blockNumber, contracts: vaultAddresses.map(vault => ({ abi: securityPoolAbi, address: pool, args: [vault], functionName: 'vaultBadDebtAttoEth' as const })), multicallAddress: MULTICALL3_ADDRESS }),
		escalationGame === zeroAddress
			? vaultAddresses.map(() => 0n)
			: client.multicall({ allowFailure: false, blockNumber, contracts: vaultAddresses.map(vault => ({ abi: escalationGameAbi, address: escalationGame, args: [vault], functionName: 'disputeStakedRepByVaultAttoRep' as const })), multicallAddress: MULTICALL3_ADDRESS }),
	])
	return vaultAddresses.map((address, index) => {
		const raw = rawVaults[index]
		const badDebtAttoEth = badDebt[index]
		const disputeStakedAttoRep = disputeStake[index]
		if (raw === undefined || badDebtAttoEth === undefined || disputeStakedAttoRep === undefined) throw new Error('Security pool returned incomplete vault state')
		const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth] = requireVaultPositionTuple(raw)
		return {
			address,
			badDebtAttoEth: requireBigint(badDebtAttoEth, 'vault bad debt'),
			capacityOwnershipAttoRep,
			openInterestAttoEth: 0n,
			backingUnits: repBackingUnits,
			vaultAttoRepBacking: 0n,
			claimableFeesAttoEth,
			disputeStakedAttoRep: requireBigint(disputeStakedAttoRep, 'vault dispute stake'),
		}
	})
}

export function hasVaultRep(vault: VaultPosition) {
	return vault.backingUnits > 0n || vault.disputeStakedAttoRep > 0n
}

type VaultChangeLog = Readonly<{ args?: unknown }>
type VaultChangeSource = (range: Readonly<{ fromBlock: bigint; toBlock: bigint }>) => Promise<readonly VaultChangeLog[]>

export async function loadChangedVaultAddresses(fromBlock: bigint, toBlock: bigint, sources: readonly VaultChangeSource[], globalDisputeStakeSources: readonly VaultChangeSource[] = [], disputeStakedVaults: readonly Address[] = []) {
	const [logsBySource, globalLogsBySource] = await Promise.all([
		Promise.all(sources.map(async source => await fetchLogsWithAdaptiveRanges({ nextBlock: fromBlock }, toBlock, MAXIMUM_VAULT_CHANGE_LOG_RANGE, source))),
		Promise.all(globalDisputeStakeSources.map(async source => await fetchLogsWithAdaptiveRanges({ nextBlock: fromBlock }, toBlock, MAXIMUM_VAULT_CHANGE_LOG_RANGE, source))),
	])
	const addresses = new Map<string, Address>()
	for (const log of logsBySource.flat()) {
		if (typeof log.args !== 'object' || log.args === null) throw new Error('Vault change event is missing its arguments')
		const vault = Reflect.get(log.args, 'vault')
		if (typeof vault !== 'string') throw new Error('Vault change event is missing its vault address')
		const address = getAddress(vault)
		addresses.set(address.toLowerCase(), address)
	}
	if (globalLogsBySource.some(logs => logs.length > 0)) {
		for (const vault of disputeStakedVaults) addresses.set(vault.toLowerCase(), vault)
	}
	return [...addresses.values()]
}

export function currentVaultPositionForPoolAccounting(vault: VaultPosition, totalAttoRep: bigint, denominator: bigint, settlementCollateralAttoEth: bigint, totalCapacityOwnershipAttoRep: bigint): VaultPosition {
	const grossOpenInterestAttoEth = vault.capacityOwnershipAttoRep === 0n || totalCapacityOwnershipAttoRep === 0n ? 0n : (settlementCollateralAttoEth * vault.capacityOwnershipAttoRep + totalCapacityOwnershipAttoRep - 1n) / totalCapacityOwnershipAttoRep
	return {
		...vault,
		openInterestAttoEth: grossOpenInterestAttoEth > vault.badDebtAttoEth ? grossOpenInterestAttoEth - vault.badDebtAttoEth : 0n,
		vaultAttoRepBacking: repForBackingUnits(vault.backingUnits, totalAttoRep, denominator),
	}
}

async function loadCurrentVaults(
	client: ReadClient,
	index: VaultStateIndex<VaultPosition>,
	pool: Address,
	escalationGame: Address,
	knownVaultCount: bigint,
	totalAttoRep: bigint,
	denominator: bigint,
	settlementCollateralAttoEth: bigint,
	totalCapacityOwnershipAttoRep: bigint,
	block: Readonly<{ hash: `0x${string}`; number: bigint }>,
) {
	const refresh = await refreshVaultStateIndex(index, {
		block,
		hasRep: hasVaultRep,
		knownVaultCount,
		loadChangedVaultAddresses: async (fromBlock, toBlock) => {
			const sources: VaultChangeSource[] = [async range => await client.getLogs({ address: pool, event: vaultAccountingCheckpointEvent, fromBlock: range.fromBlock, toBlock: range.toBlock })]
			if (escalationGame === zeroAddress) return await loadChangedVaultAddresses(fromBlock, toBlock, sources)
			sources.push(async range => await client.getLogs({ address: escalationGame, event: vaultEscrowUpdatedEvent, fromBlock: range.fromBlock, toBlock: range.toBlock }))
			const haircutSources: VaultChangeSource[] = [async range => await client.getLogs({ address: escalationGame, event: truthAuctionHaircutAppliedEvent, fromBlock: range.fromBlock, toBlock: range.toBlock })]
			const disputeStakedVaults = [...index.activeVaults.values()].filter(vault => vault.disputeStakedAttoRep > 0n).map(vault => vault.address)
			return await loadChangedVaultAddresses(fromBlock, toBlock, sources, haircutSources, disputeStakedVaults)
		},
		loadPositions: async vaults => await loadVaultPage(client, pool, escalationGame, vaults, block.number),
		loadRegistryRange: async (start, count) => {
			const page = await client.readContract({ abi: securityPoolAbi, address: pool, args: [start, count], blockNumber: block.number, functionName: 'getVaults' })
			return page.map(address => getAddress(address))
		},
		readCanonicalBlockHash: async blockNumber => (await client.getBlock({ blockNumber })).hash,
	})
	index.activeVaults = new Map(
		refresh.activeVaults.map(vault => {
			const current = currentVaultPositionForPoolAccounting(vault, totalAttoRep, denominator, settlementCollateralAttoEth, totalCapacityOwnershipAttoRep)
			return [current.address.toLowerCase(), current]
		}),
	)
	return {
		refreshedVaults: refresh.refreshedVaults.map(vault => currentVaultPositionForPoolAccounting(vault, totalAttoRep, denominator, settlementCollateralAttoEth, totalCapacityOwnershipAttoRep)),
		reset: refresh.reset,
		vaults: [...index.activeVaults.values()],
	}
}

export async function resolveOperatorVault(
	monitorIndex: PoolMonitorIndex,
	pool: Address,
	wallet: Address | undefined,
	refresh: Awaited<ReturnType<typeof loadCurrentVaults>>,
	accounting: Readonly<{ denominator: bigint; settlementCollateralAttoEth: bigint; totalAttoRep: bigint; totalCapacityOwnershipAttoRep: bigint }>,
	loadPosition: (wallet: Address) => Promise<VaultPosition>,
) {
	const poolKey = pool.toLowerCase()
	if (wallet === undefined) {
		monitorIndex.operatorVaultsByPool.delete(poolKey)
		return emptyVault(zeroAddress)
	}
	const refreshed = refresh.refreshedVaults.find(vault => sameAddress(vault.address, wallet))
	const active = refresh.vaults.find(vault => sameAddress(vault.address, wallet))
	const cached = monitorIndex.operatorVaultsByPool.get(poolKey)
	const position = refreshed ?? active ?? (refresh.reset ? emptyVault(wallet) : cached !== undefined && sameAddress(cached.address, wallet) ? cached : await loadPosition(wallet))
	const current = currentVaultPositionForPoolAccounting(position, accounting.totalAttoRep, accounting.denominator, accounting.settlementCollateralAttoEth, accounting.totalCapacityOwnershipAttoRep)
	monitorIndex.operatorVaultsByPool.set(poolKey, current)
	return current
}

async function loadPool(client: ReadClient, settings: OperatorSettings, deployment: PoolDeployment, wallet: Address | undefined, monitorIndex: PoolMonitorIndex) {
	const block = await client.getBlock()
	if (block.hash === undefined || block.number === undefined) throw new Error('Security pool scan block is missing canonical identity')
	const blockNumber = block.number
	const address = getAddress(deployment.securityPool)
	const manager = getAddress(deployment.priceOracleManagerAndOperatorQueuer)
	const [
		knownVaultCount,
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
		totalAttoRep,
	] = await Promise.all([
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'getVaultCount' }),
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
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'getPoolAccountingSnapshot' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'pendingReportId' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'pendingReportSponsor' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'repToken' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'getRequestPriceCostAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'securityPoolForker' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'systemState' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'getTotalPoolHeldAttoRep' }),
	])
	const settlementCollateralAttoEth = poolAccountingSnapshot.settlementCollateralAttoEth
	const totalCapacityOwnershipAttoRep = poolAccountingSnapshot.totalCapacityOwnershipAttoRep
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
	const vaultRefresh = await loadCurrentVaults(client, vaultIndex, address, normalizedEscalationGame, knownVaultCount, totalAttoRep, denominator, poolAccountingSnapshot.settlementCollateralAttoEth, totalCapacityOwnershipAttoRep, { hash: block.hash, number: blockNumber })
	const vaults = vaultRefresh.vaults
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
	const botVault = await resolveOperatorVault(monitorIndex, address, wallet, vaultRefresh, { denominator, settlementCollateralAttoEth, totalAttoRep, totalCapacityOwnershipAttoRep }, async operator => {
		const position = (await loadVaultPage(client, address, normalizedEscalationGame, [operator], blockNumber))[0]
		if (position === undefined) throw new Error('Security pool returned no operator vault state')
		return position
	})
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
	if (typeof securityPool !== 'string' || typeof parent !== 'string' || typeof manager !== 'string' || typeof universeId !== 'bigint' || typeof questionId !== 'bigint' || typeof multiplier !== 'bigint' || typeof priorityFee !== 'bigint' || typeof retentionRate !== 'bigint' || typeof settlementCollateral !== 'bigint') {
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

async function loadRelevantPoolDeployments(client: ReadClient, settings: OperatorSettings, block: Readonly<{ hash: `0x${string}`; number: bigint }>) {
	const loadDeployments = async (args: Readonly<{ parent?: Address; securityPool?: Address }>) =>
		(
			await fetchLogsWithAdaptiveRanges(
				{ nextBlock: 0n },
				block.number,
				MAXIMUM_DEPLOYMENT_LOG_RANGE,
				async range =>
					await client.getLogs({
						address: settings.deployment.securityPoolFactory,
						args,
						event: deploySecurityPoolEvent,
						fromBlock: range.fromBlock,
						toBlock: range.toBlock,
					}),
			)
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
				blockNumber: block.number,
				functionName: 'getOriginId',
			})
			return getAddress(
				await client.readContract({
					abi: securityPoolFactoryAbi,
					address: settings.deployment.securityPoolFactory,
					args: [originId, desired.universeId],
					blockNumber: block.number,
					functionName: 'getSecurityPool',
				}),
			)
		},
		selectedPools: settings.selectedPools,
	})
}

export async function scanPools(client: ReadClient, settings: OperatorSettings, wallet: Address | undefined, monitorIndex: PoolMonitorIndex = createPoolMonitorIndex()) {
	const universes = await loadUniverses(client, settings)
	const deploymentBlock = await client.getBlock()
	if (deploymentBlock.hash === undefined || deploymentBlock.number === undefined) throw new Error('Security pool deployment scan block is missing canonical identity')
	const deployments = await loadRelevantPoolDeployments(client, settings, { hash: deploymentBlock.hash, number: deploymentBlock.number })
	const relevantPoolKeys = new Set(deployments.map(deployment => deployment.securityPool.toLowerCase()))
	for (const poolKey of monitorIndex.vaultsByPool.keys()) {
		if (!relevantPoolKeys.has(poolKey)) monitorIndex.vaultsByPool.delete(poolKey)
	}
	for (const poolKey of monitorIndex.operatorVaultsByPool.keys()) {
		if (!relevantPoolKeys.has(poolKey)) monitorIndex.operatorVaultsByPool.delete(poolKey)
	}
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
	if ((await client.getBlock({ blockNumber: deploymentBlock.number })).hash?.toLowerCase() !== deploymentBlock.hash.toLowerCase()) throw new Error('Security pool deployments changed during discovery')
	return { pools, universes, walletRepByToken }
}

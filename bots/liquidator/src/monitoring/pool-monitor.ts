import { getAddress, zeroAddress, type Address, type Chain, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '#config/settings'
import { coordinatorAbi, erc20Abi, escalationGameAbi, securityPoolAbi, securityPoolFactoryAbi, securityPoolForkerAbi, zoltarAbi } from '#contracts/abi'
import { isPoolExecutionEligible } from '#core/fork-migration'
import { evaluateCandidate, repForBackingUnits, sortCandidates, type VaultPosition } from '#core/strategy'
import { hasStagedLiquidation } from '#core/staged-operations'
import type { PoolObservation, StagedOperationObservation, UniverseObservation } from '#state/operator-state'

type ReadClient = PublicClient<Transport, Chain>
const MULTICALL3_ADDRESS = getAddress('0xB657B12CD9d80421DBC2bc70c43d6b2ff9409108')
export const MAX_VAULT_REGISTRY_ENTRIES_SCANNED = 1_000n

export function getVaultRegistryScanCount(knownVaultCount: bigint) {
	return knownVaultCount < MAX_VAULT_REGISTRY_ENTRIES_SCANNED ? knownVaultCount : MAX_VAULT_REGISTRY_ENTRIES_SCANNED
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

export function hasCurrentVaultState(vault: VaultPosition) {
	return vault.backingUnits > 0n || vault.capacityOwnershipAttoRep > 0n || vault.claimableFeesAttoEth > 0n || vault.disputeStakedAttoRep > 0n || vault.badDebtAttoEth > 0n || vault.openInterestAttoEth > 0n
}

async function loadCurrentVaults(client: ReadClient, pool: Address, escalationGame: Address, knownVaultCount: bigint, maxVaults: number, totalAttoRep: bigint, denominator: bigint, blockNumber: bigint) {
	const vaults: VaultPosition[] = []
	const pageSize = 100n
	const scanCount = getVaultRegistryScanCount(knownVaultCount)
	for (let start = 0n; start < scanCount; start += pageSize) {
		const count = scanCount - start < pageSize ? scanCount - start : pageSize
		const page = await client.readContract({
			abi: securityPoolAbi,
			address: pool,
			args: [start, count],
			blockNumber,
			functionName: 'getVaults',
		})
		const positions = await loadVaultPage(
			client,
			pool,
			escalationGame,
			page.map(address => getAddress(address)),
			totalAttoRep,
			denominator,
			blockNumber,
		)
		for (const position of positions) {
			if (!hasCurrentVaultState(position)) continue
			vaults.push(position)
			if (vaults.length > maxVaults) return { truncated: true, vaults: vaults.slice(0, maxVaults) }
		}
	}
	return { truncated: scanCount < knownVaultCount, vaults }
}

async function loadPool(
	client: ReadClient,
	settings: OperatorSettings,
	deployment: {
		settlementCollateralAttoEth: bigint
		currentRetentionRate: bigint
		initialReportPriorityFeeAttoEthPerGas: bigint
		parent: Address
		priceOracleManagerAndOperatorQueuer: Address
		questionId: bigint
		securityPool: Address
		statoblastSecurityMultiplierBps: bigint
		universeId: bigint
	},
	wallet: Address | undefined,
) {
	const blockNumber = await client.getBlockNumber()
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
	const { vaults, truncated } = await loadCurrentVaults(client, address, normalizedEscalationGame, knownVaultCount, settings.runtime.maxVaultsPerPool, totalAttoRep, denominator, blockNumber)
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
		truncatedVaults: truncated,
		universeId: deployment.universeId,
		vaults,
	} satisfies PoolObservation
}

export async function scanPools(client: ReadClient, settings: OperatorSettings, wallet: Address | undefined) {
	const universes = await loadUniverses(client, settings)
	const count = await client.readContract({
		abi: securityPoolFactoryAbi,
		address: settings.deployment.securityPoolFactory,
		args: [],
		functionName: 'securityPoolDeploymentCount',
	})
	const deployments = []
	const deploymentPageSize = 100n
	for (let start = 0n; start < count; start += deploymentPageSize) {
		const pageCount = count - start < deploymentPageSize ? count - start : deploymentPageSize
		deployments.push(
			...(await client.readContract({
				abi: securityPoolFactoryAbi,
				address: settings.deployment.securityPoolFactory,
				args: [start, pageCount],
				functionName: 'securityPoolDeploymentsRange',
			})),
		)
	}
	const loadedPools: PoolObservation[] = []
	for (const deployment of deployments) {
		const pool = await loadPool(
			client,
			settings,
			{
				settlementCollateralAttoEth: deployment.settlementCollateralAttoEth,
				currentRetentionRate: deployment.currentRetentionRate,
				initialReportPriorityFeeAttoEthPerGas: deployment.initialReportPriorityFeeAttoEthPerGas,
				parent: getAddress(deployment.parent),
				priceOracleManagerAndOperatorQueuer: getAddress(deployment.priceOracleManagerAndOperatorQueuer),
				questionId: deployment.questionId,
				securityPool: getAddress(deployment.securityPool),
				statoblastSecurityMultiplierBps: deployment.statoblastSecurityMultiplierBps,
				universeId: deployment.universeId,
			},
			wallet,
		)
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

import { loadUniverseTree } from '@zoltar/bot-shared/monitoring/universe-policy'
import { getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { fetchLogsWithAdaptiveRanges } from '@zoltar/bot-shared/monitoring/block-sync'
import type { OperatorSettings } from '#config/settings'
import { openOraclePriceCoordinatorAbi, deploySecurityPoolEvent, erc20Abi, securityPoolAbi, securityPoolFactoryAbi, securityPoolForkerAbi } from '@zoltar/bot-shared/contracts/abi'
import { isPoolExecutionEligible } from '#core/fork-migration'
import { evaluateCandidate, sortCandidates, type VaultPosition } from '#core/strategy'
import { hasStagedLiquidation } from '#core/staged-operations'
import type { PoolObservation, StagedOperationObservation } from '#state/operator-state'
import { createVaultStateIndex } from './vault-state-index.ts'
import { discoverRelevantDeployments } from './relevant-deployments.ts'
import { validatePoolUniverseRep } from '#monitoring/pool-identity'
import { createPoolMonitorIndex, currentVaultPositionForPoolAccounting, loadCurrentVaults, loadVaultPage, resolveOperatorVault, sameAddress, type PoolMonitorIndex, type ReadClient } from '#monitoring/vault-positions'

const MAXIMUM_DEPLOYMENT_LOG_RANGE = 10_000n
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

function candidateScreeningPrice(lastPrice: bigint, fallbackPrice: bigint) {
	return lastPrice > 0n ? lastPrice : fallbackPrice
}

async function loadPool(client: ReadClient, settings: OperatorSettings, deployment: PoolDeployment, wallet: Address | undefined, monitorIndex: PoolMonitorIndex, block: Readonly<{ hash: `0x${string}`; number: bigint }>) {
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
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'currentRetentionRate' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'totalRepBackingUnits' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'escalationGame' }),
		client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [], blockNumber, functionName: 'isPriceValid' }),
		client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [], blockNumber, functionName: 'lastPrice' }),
		client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [], blockNumber, functionName: 'lastSettlementTimestamp' }),
		client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [], blockNumber, functionName: 'minLiquidationPriceDistanceBps' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'minimumSecurityBondDebtAttoEth' }),
		client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [], blockNumber, functionName: 'minimumToken1ReportAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'minimumVaultRepDepositAttoRep' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'getPoolAccountingSnapshot' }),
		client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [], blockNumber, functionName: 'pendingReportId' }),
		client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [], blockNumber, functionName: 'pendingReportSponsor' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'repToken' }),
		client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [], blockNumber, functionName: 'getRequestPriceCostAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'securityPoolForker' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'systemState' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], blockNumber, functionName: 'getTotalPoolHeldAttoRep' }),
	])
	const settlementCollateralAttoEth = poolAccountingSnapshot.settlementCollateralAttoEth
	const totalCapacityOwnershipAttoRep = poolAccountingSnapshot.totalCapacityOwnershipAttoRep
	const forkData = await client.readContract({ abi: securityPoolForkerAbi, address: securityPoolForker, args: [address], blockNumber, functionName: 'forkData' })
	const forkActivationTime = forkData[11]
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
		client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [], blockNumber, functionName: 'getActiveStagedOperationCount' }),
		client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [], blockNumber, functionName: 'getPendingSettlementOperationIds' }),
	])
	const stagedOperations: StagedOperationObservation[] = []
	const stagedTargetVaults = new Map(vaults.map(vault => [vault.address.toLowerCase(), vault]))
	for (let start = 0n; start < stagedOperationCount; start += 100n) {
		const pageCount = stagedOperationCount - start < 100n ? stagedOperationCount - start : 100n
		const [ids, operations] = await client.readContract({ abi: openOraclePriceCoordinatorAbi, address: manager, args: [start, pageCount], blockNumber, functionName: 'getActiveStagedOperations' })
		for (const [index, operation] of operations.entries()) {
			const id = ids[index]
			if (id === undefined) throw new Error('Coordinator returned mismatched staged operation arrays')
			const targetAddress = getAddress(operation.targetVault)
			let target = stagedTargetVaults.get(targetAddress.toLowerCase())
			if (target === undefined) {
				const loadedTarget = (await loadVaultPage(client, address, normalizedEscalationGame, [targetAddress], blockNumber))[0]
				if (loadedTarget === undefined) throw new Error('Security pool returned no staged-operation target state')
				target = currentVaultPositionForPoolAccounting(loadedTarget, totalAttoRep, denominator, settlementCollateralAttoEth, totalCapacityOwnershipAttoRep)
				stagedTargetVaults.set(targetAddress.toLowerCase(), target)
			}
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
				snapshotTotalRepBackingUnits: denominator,
				snapshotTargetCapacityOwnershipAttoRep: operation.snapshotTargetCapacityOwnershipAttoRep,
				snapshotTargetDisputeStakedAttoRep: target.disputeStakedAttoRep,
				snapshotTargetOpenInterestAttoEth: target.openInterestAttoEth,
				snapshotTargetBackingUnits: operation.snapshotTargetBackingUnits,
				snapshotTotalPoolHeldAttoRep: totalAttoRep,
				targetVault: targetAddress,
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

export async function scanPools(client: ReadClient, settings: OperatorSettings, wallet: Address | undefined, monitorIndex: PoolMonitorIndex = createPoolMonitorIndex(), isStopping: () => boolean = () => false) {
	const block = await client.getBlock()
	if (isStopping()) throw new Error('Operator stopping during pool scan')
	if (block.hash === undefined || block.number === undefined) throw new Error('Security pool scan block is missing canonical identity')
	const snapshotBlock = { hash: block.hash, number: block.number, timestamp: block.timestamp }
	const universes = (await loadUniverseTree(client, settings.deployment.zoltar, snapshotBlock.number)).map(universe => ({ ...universe, approved: settings.approvedUniverses.includes(universe.id) }))
	if (isStopping()) throw new Error('Operator stopping during pool scan')
	const deployments = await loadRelevantPoolDeployments(client, settings, snapshotBlock)
	if (isStopping()) throw new Error('Operator stopping during pool scan')
	const relevantPoolKeys = new Set(deployments.map(deployment => deployment.securityPool.toLowerCase()))
	for (const poolKey of monitorIndex.vaultsByPool.keys()) {
		if (!relevantPoolKeys.has(poolKey)) monitorIndex.vaultsByPool.delete(poolKey)
	}
	for (const poolKey of monitorIndex.operatorVaultsByPool.keys()) {
		if (!relevantPoolKeys.has(poolKey)) monitorIndex.operatorVaultsByPool.delete(poolKey)
	}
	const loadedPools: PoolObservation[] = []
	for (const deployment of deployments) {
		if (isStopping()) throw new Error('Operator stopping during pool scan')
		const pool = await loadPool(client, settings, deployment, wallet, monitorIndex, snapshotBlock)
		if (isStopping()) throw new Error('Operator stopping during pool scan')
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
			if (isStopping()) throw new Error('Operator stopping during pool scan')
			walletRepByToken.set(
				token.toLowerCase(),
				await client.readContract({
					abi: erc20Abi,
					address: token,
					args: [wallet],
					blockNumber: snapshotBlock.number,
					functionName: 'balanceOf',
				}),
			)
		}
	}
	if (isStopping()) throw new Error('Operator stopping during pool scan')
	if ((await client.getBlock({ blockNumber: snapshotBlock.number })).hash?.toLowerCase() !== snapshotBlock.hash.toLowerCase()) throw new Error('Security pool snapshot changed during discovery')
	return { block: snapshotBlock, pools, universes, walletRepByToken }
}

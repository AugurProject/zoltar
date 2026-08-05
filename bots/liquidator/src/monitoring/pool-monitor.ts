import { getAddress, zeroAddress, type Address, type Chain, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '#config/settings'
import { coordinatorAbi, erc20Abi, securityPoolAbi, securityPoolFactoryAbi, securityPoolForkerAbi, zoltarAbi } from '#contracts/abi'
import { isPoolExecutionEligible } from '#core/fork-migration'
import { evaluateCandidate, repForBackingUnits, sortCandidates, type VaultPosition } from '#core/strategy'
import { hasStagedLiquidation } from '#core/staged-operations'
import type { PoolObservation, StagedOperationObservation, UniverseObservation } from '#state/operator-state'

type ReadClient = PublicClient<Transport, Chain>

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
		coverageCommitmentAttoEth: 0n,
		backingUnits: 0n,
		vaultRepBackingAttoRep: 0n,
		claimableFeesAttoEth: 0n,
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

async function loadVault(client: ReadClient, pool: Address, vault: Address, totalRepAttoRep: bigint, denominator: bigint): Promise<VaultPosition> {
	const raw = await client.readContract({
		abi: securityPoolAbi,
		address: pool,
		args: [vault],
		functionName: 'securityVaults',
	})
	const [repBackingUnits, coverageCommitmentAttoEth, claimableFeesAttoEth] = raw
	return {
		address: vault,
		coverageCommitmentAttoEth,
		backingUnits: repBackingUnits,
		vaultRepBackingAttoRep: repForBackingUnits(repBackingUnits, totalRepAttoRep, denominator),
		claimableFeesAttoEth,
	}
}

async function loadVaultAddresses(client: ReadClient, pool: Address, activeVaultCount: bigint, maxVaults: number) {
	const limit = activeVaultCount < BigInt(maxVaults) ? activeVaultCount : BigInt(maxVaults)
	const addresses: Address[] = []
	const pageSize = 100n
	for (let start = 0n; start < limit; start += pageSize) {
		const count = limit - start < pageSize ? limit - start : pageSize
		const page = await client.readContract({
			abi: securityPoolAbi,
			address: pool,
			args: [start, count],
			functionName: 'getActiveVaults',
		})
		addresses.push(...page.map(getAddress))
	}
	return { addresses, truncated: limit < activeVaultCount }
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
	const address = getAddress(deployment.securityPool)
	const manager = getAddress(deployment.priceOracleManagerAndOperatorQueuer)
	const [
		activeVaultCount,
		settlementCollateralAttoEth,
		currentRetentionRate,
		denominator,
		isPriceValid,
		lastPrice,
		lastSettlementTimestamp,
		minLiquidationPriceDistanceBps,
		minimumToken1ReportAttoEth,
		pendingReportId,
		pendingReportSponsor,
		repToken,
		requestPriceCostAttoEth,
		securityPoolForker,
		systemState,
		totalCoverageCommitmentAttoEth,
		totalRepAttoRep,
	] = await Promise.all([
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'getActiveVaultCount' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'settlementCollateralAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'currentRetentionRate' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'totalRepBackingUnits' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'isPriceValid' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'lastPrice' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'lastSettlementTimestamp' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'minLiquidationPriceDistanceBps' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'minimumToken1ReportAttoEth' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'pendingReportId' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'pendingReportSponsor' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'repToken' }),
		client.readContract({ abi: coordinatorAbi, address: manager, args: [], functionName: 'getRequestPriceCostAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'securityPoolForker' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'systemState' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'totalCoverageCommitmentAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address, args: [], functionName: 'getTotalPoolHeldRepAttoRep' }),
	])
	const [forkData, forkActivationTime] = await Promise.all([
		client.readContract({ abi: securityPoolForkerAbi, address: securityPoolForker, args: [address], functionName: 'forkData' }),
		client.readContract({ abi: securityPoolForkerAbi, address: securityPoolForker, args: [address], functionName: 'getForkActivationTime' }),
	])
	const forkOutcomeIndex = deployment.parent === zeroAddress ? undefined : forkData[10]
	const { addresses, truncated } = await loadVaultAddresses(client, address, activeVaultCount, settings.runtime.maxVaultsPerPool)
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
				amount: operation.amount,
				id,
				initiatorVault: getAddress(operation.initiatorVault),
				isPendingSettlement: pendingSettlementOperationIds.includes(id),
				operation: operation.operation,
				queuedAt: operation.queuedAt,
				snapshotTotalRepBackingUnits: operation.snapshotTotalRepBackingUnits,
				snapshotTargetCoverageCommitmentAttoEth: operation.snapshotTargetCoverageCommitmentAttoEth,
				snapshotTargetBackingUnits: operation.snapshotTargetBackingUnits,
				snapshotTotalPoolHeldRepAttoRep: operation.snapshotTotalPoolHeldRepAttoRep,
				targetVault: getAddress(operation.targetVault),
				validForSeconds: operation.validForSeconds,
			})
		}
	}
	const vaults = await Promise.all(addresses.map(async vault => await loadVault(client, address, vault, totalRepAttoRep, denominator)))
	const botVault = wallet === undefined ? emptyVault(zeroAddress) : (vaults.find(vault => sameAddress(vault.address, wallet)) ?? (await loadVault(client, address, wallet, totalRepAttoRep, denominator)))
	const selected = settings.selectedPools.some(pool => sameAddress(pool, address))
	const approvedUniverse = settings.approvedUniverses.includes(deployment.universeId)
	const riskContext = {
		address,
		denominator,
		manager,
		minLiquidationPriceDistanceBps,
		multiplierBps: deployment.statoblastSecurityMultiplierBps,
		price: candidateScreeningPrice(lastPrice, settings.strategy.fallbackRepPerEthPrice),
		totalRepAttoRep,
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
		activeVaultCount,
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
		minimumToken1ReportAttoEth,
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
		totalCoverageCommitmentAttoEth,
		totalRepAttoRep,
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

import { DISCOVERY_AGGREGATE_ITEM_LIMIT, type EcosystemDiscoveryContext } from './discovery-context.ts'
import { erc1155Abi, shareTokenAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import { validForkOutcomeRoutes } from '../operations/fork-outcomes.ts'
import { type EcosystemDeployments, type OracleGameSnapshot, type PairSnapshot, type PoolSnapshot, type QuestionSnapshot, type ShareInventory, type UniverseSnapshot } from '../operations/types.ts'
import { DISCOVERY_RPC_CONCURRENCY, drainConcurrent, mapWithConcurrency } from './discovery-client.ts'
import { OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT, trustedOpenOracleReportPredicate } from './protocol-index.ts'
import { type Address } from '@zoltar/bot-shared/ethereum'

export function trustedIndexedReportsForDiscovery(parameters: { deployments: EcosystemDeployments; wallet: Address; reports: readonly OracleGameSnapshot[]; universes: readonly UniverseSnapshot[]; pools: readonly PoolSnapshot[] }) {
	const coordinatorReports = parameters.pools.flatMap(pool =>
		pool.pendingReportId === '0'
			? []
			: [
					{
						coordinator: pool.coordinator,
						pendingReportId: pool.pendingReportId,
						repToken: pool.repToken,
					},
				],
	)
	const trustedReport = trustedOpenOracleReportPredicate({
		coordinatorReports,
		maximumSettlementStepGasLimit: OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT,
		openOracle: parameters.deployments.openOracle,
		trustedRepTokens: parameters.universes.map(universe => universe.repToken),
		wallet: parameters.wallet,
		weth: parameters.deployments.weth,
	})
	return parameters.reports.filter(trustedReport)
}

export async function discoverShareInventory(context: EcosystemDiscoveryContext, pools: readonly PoolSnapshot[], pairs: readonly PairSnapshot[], universes: readonly UniverseSnapshot[], questions: readonly QuestionSnapshot[], blockNumber: bigint, warnings: string[]) {
	const { client, deployments, wallet } = context
	if (wallet === undefined) return []
	const shares: ShareInventory[] = []
	const universeById = new Map(universes.map(universe => [universe.id, universe]))
	const questionById = new Map(questions.map(question => [question.id, question]))
	const operatorsByShareToken = new Map<string, Map<string, Address>>()
	for (const pair of pairs) {
		const key = pair.shareToken.toLowerCase()
		const operators = operatorsByShareToken.get(key) ?? new Map<string, Address>()
		operators.set(deployments.tradingRouter.toLowerCase(), deployments.tradingRouter)
		operators.set(pair.address.toLowerCase(), pair.address)
		operatorsByShareToken.set(key, operators)
	}
	const operatorsFor = (shareToken: Address) => {
		const key = shareToken.toLowerCase()
		const operators = operatorsByShareToken.get(key) ?? new Map<string, Address>()
		operators.set(deployments.tradingRouter.toLowerCase(), deployments.tradingRouter)
		operatorsByShareToken.set(key, operators)
		return operators
	}
	const migrationTargetsFor = (pool: PoolSnapshot) => {
		const universe = universeById.get(pool.universeId)
		if (universe === undefined || universe.forkTime === '0') return []
		return validForkOutcomeRoutes(questionById.get(universe.forkQuestionId), universe.knownChildOutcomes)
	}
	const plannedKeys = new Set<string>()
	let plannedFanout = 0n
	for (const pool of pools) {
		const key = `${pool.shareToken.toLowerCase()}:${pool.universeId}`
		if (plannedKeys.has(key)) continue
		plannedKeys.add(key)
		const targetCount = BigInt(migrationTargetsFor(pool).length)
		plannedFanout += BigInt(operatorsFor(pool.shareToken).size) + 4n * targetCount
		if (plannedFanout > BigInt(DISCOVERY_AGGREGATE_ITEM_LIMIT)) {
			warnings.push(`Share-inventory discovery truncated because planned approval and migration fan-out is at least ${plannedFanout.toString()} entries, exceeding the configured ${DISCOVERY_AGGREGATE_ITEM_LIMIT.toString()}-entry aggregate limit`)
			return []
		}
	}
	const seen = new Set<string>()
	for (const pool of pools) {
		const key = `${pool.shareToken.toLowerCase()}:${pool.universeId}`
		if (seen.has(key)) continue
		seen.add(key)
		const base = BigInt(pool.universeId) << 8n
		const operators = operatorsFor(pool.shareToken)
		const [invalid, yes, no] = await drainConcurrent([0n, 1n, 2n].map(outcome => client.readContract({ abi: erc1155Abi, address: pool.shareToken, args: [wallet, base | outcome], blockNumber, functionName: 'balanceOf' })))
		if (invalid === undefined || yes === undefined || no === undefined) throw new Error(`Share token ${pool.shareToken} returned incomplete balances`)
		const approvals: Record<string, boolean> = {}
		for (const operator of operators.values()) {
			approvals[operator] = await client.readContract({ abi: erc1155Abi, address: pool.shareToken, args: [wallet, operator], blockNumber, functionName: 'isApprovedForAll' })
		}
		const migrationProgressByRoute: Record<string, string> = {}
		const targetOutcomes = migrationTargetsFor(pool)
		if (targetOutcomes.length > 0) {
			const childUniverses = await mapWithConcurrency(targetOutcomes, DISCOVERY_RPC_CONCURRENCY, async targetOutcome => await client.readContract({ abi: zoltarAbi, address: deployments.zoltar, args: [BigInt(pool.universeId), BigInt(targetOutcome)], blockNumber, functionName: 'getChildUniverseId' }))
			const balances = [invalid, yes, no]
			for (let sourceOutcome = 0; sourceOutcome < balances.length; sourceOutcome += 1) {
				if ((balances[sourceOutcome] ?? 0n) === 0n) continue
				const fromId = base | BigInt(sourceOutcome)
				for (let targetIndex = 0; targetIndex < childUniverses.length; targetIndex += 1) {
					const targetUniverseId = childUniverses[targetIndex]
					const targetOutcome = targetOutcomes[targetIndex]
					if (targetUniverseId === undefined || targetOutcome === undefined) throw new Error(`Missing child universe id for fork outcome index ${targetIndex.toString()}`)
					const migrated = await client.readContract({ abi: shareTokenAbi, address: pool.shareToken, args: [fromId, targetUniverseId, wallet], blockNumber, functionName: 'getMigratedShareAmountAttoShares' })
					migrationProgressByRoute[`${sourceOutcome.toString()}:${targetOutcome}`] = migrated.toString()
				}
			}
		}
		shares.push({ invalid: invalid.toString(), isApprovedForAll: approvals, migrationProgressByRoute, no: no.toString(), shareToken: pool.shareToken, universeId: pool.universeId, yes: yes.toString() })
	}
	return shares
}

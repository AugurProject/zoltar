import type { DiscoveryRun } from './discovery-context.ts'

import * as abis from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'

import { compareUnsignedStrings } from '../core/units.ts'

import type { MigrationRepSplitProgressSnapshot, UniverseSnapshot } from '../operations/types.ts'
import { drainConcurrent } from './discovery-client.ts'

export async function discoverUniverses({ context, blockNumber, limits, topology, mutation, issues }: DiscoveryRun) {
	const { client, deployments, wallet } = context
	const queue = [0n]
	const queuedIds = new Set<string>(['0'])
	const seen = new Set<string>()
	const retainedUniverseIds = new Set<string>(['0'])
	const universes: UniverseSnapshot[] = []
	let truncated = false
	const cachedUniverseIds = new Set<string>(['0'])
	for (const [universeId, children] of Object.entries(topology.universeChildren)) {
		cachedUniverseIds.add(universeId)
		for (const childId of children.childUniverseIds) cachedUniverseIds.add(childId)
	}
	if (cachedUniverseIds.size > limits.maxUniverses) {
		topology.universeChildren = {}
		mutation.changed = true
	}
	const forkBurnDivisor = await client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, blockNumber, functionName: 'forkBurnDivisor' })
	const migrationProgressByUniverse = new Map<string, MigrationRepSplitProgressSnapshot[]>()
	for (const progress of context.indexedMigrationRepSplits ?? []) {
		const routes = migrationProgressByUniverse.get(progress.universeId) ?? []
		routes.push(progress)
		migrationProgressByUniverse.set(progress.universeId, routes)
	}
	for (const routes of migrationProgressByUniverse.values()) routes.sort((left, right) => compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex))
	for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
		const universeId = queue[queueIndex]
		if (universeId === undefined) throw new Error('Universe traversal lost its current entry')
		queuedIds.delete(universeId.toString())
		if (seen.has(universeId.toString())) continue
		seen.add(universeId.toString())
		const [raw, threshold, nonDecisionThreshold, migration, universeTheoreticalSupply] = await drainConcurrent([
			client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [universeId], blockNumber, functionName: 'universes' }),
			client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [universeId], blockNumber, functionName: 'getForkThresholdAttoRep' }),
			client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [universeId], blockNumber, functionName: 'getNonDecisionThresholdAttoRep' }),
			wallet === undefined ? Promise.resolve(0n) : client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [wallet, universeId], blockNumber, functionName: 'getMigrationRepBalanceAttoRep' }),
			client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [universeId], blockNumber, functionName: 'getUniverseTheoreticalSupplyAttoRep' }),
		])
		const [forkTime, forkQuestionId, forkingOutcomeIndex, reputationToken, parentUniverseId] = raw
		if (reputationToken === zeroAddress) throw new Error(`Universe ${universeId.toString()} has no REP token`)
		const supplyBasedDeposit = universeTheoreticalSupply / 10_000_000n
		const initialEscalationDeposit = supplyBasedDeposit < 10n ** 18n ? 10n ** 18n : supplyBasedDeposit
		const cachedChildren = topology.universeChildren[universeId.toString()]
		const outcomes = (cachedChildren?.outcomeIndexes ?? []).map(outcome => BigInt(outcome))
		const childIds = (cachedChildren?.childUniverseIds ?? []).map(childId => BigInt(childId))
		if (outcomes.length !== childIds.length) throw new Error(`Universe ${universeId.toString()} immutable child cache has mismatched arrays`)
		for (const childId of childIds) {
			if (retainedUniverseIds.size >= limits.maxUniverses && !retainedUniverseIds.has(childId.toString())) {
				truncated = true
				break
			}
			retainedUniverseIds.add(childId.toString())
		}
		if (!truncated) {
			for (let start = BigInt(outcomes.length); ; ) {
				const remainingSlots = limits.maxUniverses - retainedUniverseIds.size
				const requestedPageSize = BigInt(Math.max(1, Math.min(limits.maxUniverses, remainingSlots + 1)))
				const [pageOutcomes, pageChildIds, pageChildren] = await client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [universeId, start, requestedPageSize], blockNumber, functionName: 'getDeployedChildUniverses' })
				if (pageOutcomes.length !== pageChildIds.length || pageOutcomes.length !== pageChildren.length) throw new Error(`Universe ${universeId.toString()} returned mismatched child arrays`)
				if (BigInt(pageOutcomes.length) > requestedPageSize) throw new Error(`Universe ${universeId.toString()} exceeded the requested child page size`)
				const accepted = Math.min(pageOutcomes.length, remainingSlots)
				for (let index = 0; index < accepted; index += 1) {
					const outcome = pageOutcomes[index]
					const childId = pageChildIds[index]
					if (outcome === undefined || childId === undefined) throw new Error(`Universe ${universeId.toString()} omitted a retained child route`)
					outcomes.push(outcome)
					childIds.push(childId)
					retainedUniverseIds.add(childId.toString())
				}
				if (accepted > 0) mutation.changed = true
				if (accepted < pageOutcomes.length) {
					truncated = true
					break
				}
				if (BigInt(pageOutcomes.length) < requestedPageSize) break
				start += BigInt(pageOutcomes.length)
			}
		}
		if (new Set(outcomes.map(outcome => outcome.toString())).size !== outcomes.length || new Set(childIds.map(childId => childId.toString())).size !== childIds.length) throw new Error(`Universe ${universeId.toString()} returned duplicate immutable child routes`)
		topology.universeChildren[universeId.toString()] = {
			childUniverseIds: childIds.map(childId => childId.toString()),
			outcomeIndexes: outcomes.map(outcome => outcome.toString()),
		}
		for (const childId of childIds) {
			const childKey = childId.toString()
			if (!seen.has(childKey) && !queuedIds.has(childKey)) {
				queue.push(childId)
				queuedIds.add(childKey)
			}
		}
		const snapshot: UniverseSnapshot = {
			forkBurnDivisor: forkBurnDivisor.toString(),
			forkQuestionId: forkQuestionId.toString(),
			forkThresholdAttoRep: threshold.toString(),
			forkTime: forkTime.toString(),
			id: universeId.toString(),
			initialEscalationDepositAttoRep: initialEscalationDeposit.toString(),
			knownChildOutcomes: outcomes.map(outcome => outcome.toString()),
			migrationBalance: migration.toString(),
			migrationRepSplitProgressByOutcome: Object.fromEntries((migrationProgressByUniverse.get(universeId.toString()) ?? []).map(progress => [progress.outcomeIndex, progress.childMigrationRepAmountAttoRep])),
			nonDecisionThresholdAttoRep: nonDecisionThreshold.toString(),
			repToken: getAddress(reputationToken),
		}
		if (universeId !== 0n) {
			snapshot.forkingOutcomeIndex = forkingOutcomeIndex.toString()
			snapshot.parentUniverseId = parentUniverseId.toString()
		}
		universes.push(snapshot)
	}
	if (truncated) issues.push({ kind: 'universe-limit', retained: universes.length, limit: limits.maxUniverses })
	return universes
}

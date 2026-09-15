import { EcosystemSnapshot, OperationDefinition, OperationEvidence, PlanningOptions, PoolSnapshot } from '../types.ts'

import { amount, choose, disabled, eligible, encodeStep, eventTopic, mixSeed, planBase } from '../planning.ts'

import { ORACLE_PRICE_VALIDITY_SECONDS, stagedDownstreamPreflight } from './planning.ts'

import { timestampDeadlineHasRequiredSafety } from '../timing.ts'

import { openOraclePriceCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'

export const queueLiquidation: OperationDefinition = {
	buildPlan: () => undefined,
	classification: 'excluded-dangerous',
	contract: 'OpenOraclePriceCoordinator',
	description: 'The coordinator snapshots mutable target and pool state only at inclusion, so calldata cannot bind the simulated result or require zero bad debt.',
	discoveryInputs: ['liquidation calldata guards', 'atomic state binding'],
	ecosystem: 'statoblast',
	evaluate: () => disabled('Unguarded liquidation queueing can execute a different inclusion-time result, including nonzero bad debt'),
	id: 'statoblast.liquidation.queue',
	label: 'Queue liquidation (excluded)',
	method: 'requestPriceIfNeededAndStageLiquidation',
	risk: 'high',
}

export function stagedObligation(mode: 'execute' | 'expire'): OperationDefinition {
	const id = `statoblast.staged.${mode}`
	const metadata = (staged: EcosystemSnapshot['stagedOperations'][number]) => ({ coordinator: staged.coordinator, operationId: staged.id, operationType: staged.operation })
	const stagedDeadline = (pool: PoolSnapshot, operation: EcosystemSnapshot['stagedOperations'][number]) => amount(operation.queuedAt) + amount(pool.oracleSettlementTime) + amount(operation.validForSeconds)
	const executionDeadline = (pool: PoolSnapshot, operation: EcosystemSnapshot['stagedOperations'][number]) => {
		const operationDeadline = stagedDeadline(pool, operation)
		const oracleDeadline = amount(pool.lastOracleSettlementTimestamp) + ORACLE_PRICE_VALIDITY_SECONDS
		return operationDeadline < oracleDeadline ? operationDeadline : oracleDeadline
	}
	const candidates = (snapshot: EcosystemSnapshot, options: PlanningOptions) => {
		const now = amount(snapshot.anchor.timestamp)
		return snapshot.stagedOperations.filter(operation => {
			const pool = snapshot.pools.find(candidate => candidate.coordinator.toLowerCase() === operation.coordinator.toLowerCase())
			if (pool === undefined) return false
			return mode === 'execute' ? (operation.operation === 1 || operation.operation === 2) && operation.executionExpectedSuccess && pool.oraclePriceValid && timestampDeadlineHasRequiredSafety(now, executionDeadline(pool, operation), options) : now > stagedDeadline(pool, operation)
		})
	}
	const build = (snapshot: EcosystemSnapshot, staged: EcosystemSnapshot['stagedOperations'][number]) => {
		const pool = snapshot.pools.find(candidate => candidate.coordinator.toLowerCase() === staged.coordinator.toLowerCase())
		if (pool === undefined) return undefined
		const deadline = (mode === 'execute' ? executionDeadline(pool, staged) : stagedDeadline(pool, staged)).toString()
		const signature = 'ExecutedStagedOperation(uint256,uint8,bool,string)'
		const successEvidence: OperationEvidence = {
			abi: 'event ExecutedStagedOperation(uint256 indexed operationId, uint8 operation, bool success, string errorMessage)',
			emitter: staged.coordinator,
			equals: mode === 'execute',
			field: 'success',
			indexed: { operationId: staged.id },
			kind: 'decoded-event-field',
			signature,
			topic0: eventTopic(signature),
		}
		const evidence: OperationEvidence[] = [successEvidence]
		evidence.push({ ...successEvidence, equals: staged.operation, field: 'operation' })
		if (mode === 'expire') {
			evidence.push({
				abi: successEvidence.abi,
				emitter: staged.coordinator,
				equals: 'staged operation expired',
				field: 'errorMessage',
				indexed: { operationId: staged.id },
				kind: 'decoded-event-field',
				signature,
				topic0: successEvidence.topic0,
			})
		}
		const preflight = mode === 'execute' ? stagedDownstreamPreflight(pool, staged) : undefined
		if (mode === 'execute' && preflight === undefined) return undefined
		return planBase({
			deadlineTimestamp: mode === 'execute' ? deadline : undefined,
			definitionId: id,
			ecosystem: 'statoblast',
			label: mode === 'execute' ? 'Execute staged operation' : 'Expire staged operation',
			metadata: metadata(staged),
			postconditions: [mode === 'execute' ? 'Decoded ExecutedStagedOperation.success is true; success=false is a failed workflow' : 'The expired operation is consumed and no longer active'],
			priority: 'urgent',
			risk: 'low',
			snapshot,
			steps: [
				encodeStep({
					abi: openOraclePriceCoordinatorAbi,
					args: [BigInt(staged.id)],
					evidence,
					functionName: mode === 'execute' ? 'executeStagedOperation' : 'expireStagedOperation',
					id: `${mode}-staged-${staged.id}`,
					label: `${mode} staged operation ${staged.id}`,
					preflightCalls: preflight === undefined ? [] : [preflight],
					to: staged.coordinator,
				}),
			],
		})
	}
	return {
		buildPlan(snapshot, options) {
			const staged = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return staged === undefined ? undefined : build(snapshot, staged)
		},
		buildLifecyclePlans(snapshot, options) {
			return candidates(snapshot, options).flatMap(staged => {
				const plan = build(snapshot, staged)
				return plan === undefined ? [] : [plan]
			})
		},
		enumerateLifecycleObstructingPresence(snapshot, options) {
			return candidates(snapshot, options).map(metadata)
		},
		enumerateLifecyclePresence(snapshot) {
			return snapshot.stagedOperations.filter(operation => mode === 'expire' || operation.operation === 1 || operation.operation === 2).map(metadata)
		},
		classification: 'lifecycle-obligation',
		contract: 'OpenOraclePriceCoordinator',
		description: `${mode === 'execute' ? 'Executes a fresh oracle-gated workflow and requires semantic success' : 'Consumes an expired workflow so it cannot block recovery'}.`,
		discoveryInputs: ['active staged operations', 'oracle validity', 'settlement time', 'anchor timestamp', 'anchored direct mutation simulation'],
		ecosystem: 'statoblast',
		evaluate(snapshot, options) {
			const now = amount(snapshot.anchor.timestamp)
			const found = snapshot.stagedOperations.some(operation => {
				const pool = snapshot.pools.find(candidate => candidate.coordinator.toLowerCase() === operation.coordinator.toLowerCase())
				if (pool === undefined) return false
				return mode === 'execute' ? (operation.operation === 1 || operation.operation === 2) && operation.executionExpectedSuccess && pool.oraclePriceValid && timestampDeadlineHasRequiredSafety(now, executionDeadline(pool, operation), options) : now > stagedDeadline(pool, operation)
			})
			return eligible(found ? undefined : `No staged operation is ready to ${mode}`)
		},
		id,
		label: `${mode} staged operation`,
		method: mode === 'execute' ? 'executeStagedOperation' : 'expireStagedOperation',
		risk: 'low',
	}
}

export const executeStagedLiquidation: OperationDefinition = {
	buildPlan: () => undefined,
	classification: 'excluded-dangerous',
	contract: 'OpenOraclePriceCoordinator',
	description: 'Executing a staged liquidation is delegated to a policy-aware liquidator because live price, open interest, and pool accounting can change the irreversible bad-debt result after preflight.',
	discoveryInputs: ['active staged liquidation operation', 'mutable liquidation accounting and ordering risk'],
	ecosystem: 'statoblast',
	evaluate: () => disabled('Staged liquidation execution cannot bind its irreversible live-state result at inclusion'),
	id: 'statoblast.staged.execute-liquidation-excluded',
	label: 'Execute staged liquidation (excluded)',
	method: 'executeStagedOperation',
	risk: 'high',
}

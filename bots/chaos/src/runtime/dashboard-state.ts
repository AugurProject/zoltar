import { schedulerIsDue } from '../core/scheduler.ts'
import { lifecyclePresenceBlockerMessage, MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS } from './obligations.ts'
import { workflowNeedsOperatorReconciliation } from './workflows.ts'
import { MAXIMUM_OBLIGATION_TOMBSTONE_COUNT, type RuntimeState } from '../state/operator-state.ts'
import type { ConfigurationState } from './dashboard-controller.ts'

function groupedOperationEvaluations(state: RuntimeState, enabled: ReadonlySet<string>) {
	const rows = new Map<
		string,
		{
			blockers: string[]
			candidateCount: number
			classification: (typeof state.evaluations)[number]['definition']['classification']
			description: string
			ecosystem: (typeof state.evaluations)[number]['definition']['ecosystem']
			eligible: boolean
			enabled: boolean
			id: string
			independentlyExecutable: boolean
			label: string
			prerequisites: string[]
			risk: (typeof state.evaluations)[number]['definition']['risk']
		}
	>()
	for (const evaluation of state.evaluations) {
		const id = evaluation.definition.id
		const existing = rows.get(id)
		if (existing === undefined) {
			rows.set(id, {
				blockers: [...new Set(evaluation.eligibility.blockers)],
				candidateCount: evaluation.plan === undefined ? 0 : 1,
				classification: evaluation.definition.classification,
				description: evaluation.definition.description,
				ecosystem: evaluation.definition.ecosystem,
				eligible: evaluation.eligibility.eligible,
				enabled: enabled.has(evaluation.definition.ecosystem),
				id,
				independentlyExecutable: evaluation.definition.independentlyExecutable ?? (evaluation.definition.classification === 'selectable' || evaluation.definition.classification === 'lifecycle-obligation'),
				label: evaluation.definition.label,
				prerequisites: [...new Set(evaluation.definition.discoveryInputs)],
				risk: evaluation.definition.risk,
			})
			continue
		}
		existing.candidateCount += evaluation.plan === undefined ? 0 : 1
		existing.eligible ||= evaluation.eligibility.eligible
		existing.blockers = [...new Set([...existing.blockers, ...evaluation.eligibility.blockers])]
		existing.prerequisites = [...new Set([...existing.prerequisites, ...evaluation.definition.discoveryInputs])]
	}
	return [...rows.values()]
}

export function dashboardState(state: RuntimeState, configuration: ConfigurationState) {
	const currentWorkflow = state.workflows.find(workflow => workflow.status === 'running' || workflow.status === 'waiting-continuation' || workflow.status === 'waiting-obligation' || workflow.status === 'waiting-transaction' || workflowNeedsOperatorReconciliation(workflow))
	const enabled = new Set(configuration.settings.strategy.enabledEcosystems)
	const lifecyclePresenceAlert = state.lifecyclePresenceBlocker === undefined ? undefined : lifecyclePresenceBlockerMessage(state.lifecyclePresenceBlocker)
	return {
		...state,
		alerts: [
			...(state.deploymentNotice === undefined ? [] : [{ message: state.deploymentNotice, severity: 'info' }]),
			...(state.error === undefined ? [] : [{ message: state.error, severity: 'error' }]),
			...(lifecyclePresenceAlert === undefined || lifecyclePresenceAlert === state.error ? [] : [{ message: lifecyclePresenceAlert, severity: 'error' }]),
			...(state.safetyPaused
				? [
						{
							message: 'Safety pause is latched; review the failure activity and current recovery state before explicitly resuming execution',
							severity: 'error',
						},
					]
				: []),
			...(state.obligationTombstones.length >= MAXIMUM_OBLIGATION_TOMBSTONE_COUNT * 0.8
				? [
						{
							message: `Lifecycle tombstone journal is at ${state.obligationTombstones.length.toString()} of ${MAXIMUM_OBLIGATION_TOMBSTONE_COUNT.toString()} entries; complete canonical scans so retired identities can be pruned`,
							severity: 'warning',
						},
					]
				: []),
			...state.warnings.map(message => ({ message, severity: 'warning' })),
		],
		currentWorkflow,
		execute: configuration.settings.runtime.execute,
		inventoryAvailable: state.wallet !== undefined && state.inventoryAddress?.toLowerCase() === state.wallet.toLowerCase(),
		network: configuration.settings.network.name,
		obligations: state.obligations.filter(obligation => obligation.status !== 'abandoned' && obligation.status !== 'completed').map(obligation => ({ ...obligation, automaticRetryLimit: MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS })),
		operationEvaluations: groupedOperationEvaluations(state, enabled),
		scheduler: {
			...state.scheduler,
			due: schedulerIsDue(state.scheduler.status === 'due' ? { ...state.scheduler, status: 'scheduled' } : state.scheduler),
		},
		signerReady: configuration.settings.privateKey !== undefined,
		topology:
			state.topology === undefined
				? undefined
				: {
						...state.topology,
						auctions: state.topology.auctions.map(auction => ({ ...auction })),
						pairs: state.topology.pairs.map(pair => ({ ...pair })),
						pools: state.topology.pools.map(pool => ({ ...pool })),
						reports: state.topology.reports.map(report => ({ ...report })),
						universes: state.topology.universes.map(universe => ({ ...universe })),
					},
	}
}

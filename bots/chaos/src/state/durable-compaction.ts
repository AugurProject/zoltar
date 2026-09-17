import type { DurableState } from './operator-state.ts'

export const MAXIMUM_ACTIVITY_COUNT = 500
export const MAXIMUM_OBLIGATION_TOMBSTONE_COUNT = 10_000
const MAXIMUM_TERMINAL_OBLIGATION_COUNT = 500
const MAXIMUM_TERMINAL_WORKFLOW_COUNT = 500

function newestIds<T extends { id: string; updatedAt: string }>(values: readonly T[], limit: number) {
	return new Set(
		[...values]
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
			.slice(0, limit)
			.map(value => value.id),
	)
}

function replaceArrayContents<T>(target: T[], retained: readonly T[]) {
	target.splice(0, target.length, ...retained)
}

export function compactDurableState(state: Pick<DurableState, 'rollbackQueue' | 'includedTransactions' | 'activities' | 'obligationTombstones' | 'obligations' | 'pendingTransactions' | 'workflows'>) {
	if (state.activities.length > MAXIMUM_ACTIVITY_COUNT) state.activities.splice(MAXIMUM_ACTIVITY_COUNT)
	const tombstones = new Map(state.obligationTombstones.map(tombstone => [tombstone.id, tombstone]))
	for (const obligation of state.obligations) {
		if (obligation.status !== 'completed' && obligation.status !== 'abandoned') continue
		if (tombstones.has(obligation.id)) continue
		const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
		tombstones.set(obligation.id, {
			id: obligation.id,
			resolution: obligation.status,
			resolvedAt: obligation.status === 'completed' ? (obligation.completedAt ?? obligation.updatedAt) : (obligation.resolvedAt ?? obligation.updatedAt),
			resolvedAtBlock: workflow?.createdAtBlock ?? '0',
			...(obligation.status === 'abandoned'
				? {
						resolutionReason: obligation.resolutionReason ?? 'Manually abandoned by the operator',
					}
				: {}),
		})
	}
	if (tombstones.size > MAXIMUM_OBLIGATION_TOMBSTONE_COUNT) {
		throw new Error(`Chaos-bot state contains more than ${MAXIMUM_OBLIGATION_TOMBSTONE_COUNT.toString()} obligation tombstones`)
	}
	replaceArrayContents(state.obligationTombstones, [...tombstones.values()])
	const terminalObligations = state.obligations.filter(obligation => obligation.status === 'abandoned' || obligation.status === 'completed' || obligation.status === 'failed')
	const retainedTerminalObligationIds = newestIds(terminalObligations, MAXIMUM_TERMINAL_OBLIGATION_COUNT)
	const retainedObligations = state.obligations.filter(obligation => (obligation.status !== 'abandoned' && obligation.status !== 'completed' && obligation.status !== 'failed' ? true : retainedTerminalObligationIds.has(obligation.id)))
	replaceArrayContents(state.obligations, retainedObligations)
	const protectedWorkflowIds = new Set([...state.rollbackQueue.map(record => record.workflow.id), ...state.includedTransactions.map(record => record.workflow.id), ...state.pendingTransactions.map(intent => intent.workflowId), ...state.obligations.map(obligation => obligation.workflowId)])
	const terminalWorkflows = state.workflows.filter(workflow => workflow.status === 'abandoned' || workflow.status === 'completed' || workflow.status === 'failed')
	const retainedTerminalWorkflowIds = newestIds(terminalWorkflows, MAXIMUM_TERMINAL_WORKFLOW_COUNT)
	const retainedWorkflows = state.workflows.filter(workflow => {
		if (workflow.status !== 'abandoned' && workflow.status !== 'completed' && workflow.status !== 'failed') return true
		return protectedWorkflowIds.has(workflow.id) || retainedTerminalWorkflowIds.has(workflow.id)
	})
	replaceArrayContents(state.workflows, retainedWorkflows)
	return state
}

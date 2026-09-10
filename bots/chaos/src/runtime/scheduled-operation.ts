import { createChaosScheduler } from '../core/scheduler.ts'
import { MAXIMUM_PUBLIC_FIELD_LENGTH, safeString } from '../dashboard/public-fields.ts'
import { isoTimestampFromSeconds } from '../core/units.ts'
import { TransactionAwaitingRecovery } from '../execution/transaction-executor.ts'
import type { OperationPlan } from '../operations/types.ts'
import { recordActivity, saveDurableState, type RuntimeState } from '../state/operator-state.ts'
import type { ConfigurationState } from './dashboard-controller.ts'

export function schedulerFor(configuration: ConfigurationState, state: RuntimeState) {
	return createChaosScheduler({
		persist: async candidate => {
			await saveDurableState(configuration.settings.runtime.stateFile, {
				...state,
				scheduler: candidate,
			})
		},
		settings: configuration.settings.scheduler,
		state: state.scheduler,
	})
}

const SHORT_ADDRESS_TAIL = 4
const TRUNCATION_NOTICE = '… (truncated)'

function shortAddress(value: string) {
	return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-SHORT_ADDRESS_TAIL)}`
}

function functionSelector(data: string) {
	return data.length >= 10 ? data.slice(0, 10) : data
}

function describeStep(step: OperationPlan['steps'][number], index: number) {
	const parts = [`to ${shortAddress(step.to)}`, `selector ${functionSelector(step.data)}`, `gas ${step.gasLimit}`]
	if (step.value !== undefined && step.value !== '0') parts.push(`value ${step.value} wei`)
	return `${(index + 1).toString()}. ${step.label} (${parts.join(', ')})`
}

/** Human-readable account of the exact work a dry run planned but deliberately did not sign. */
function dryRunDetails(plan: OperationPlan) {
	const sections = [`Operation ${plan.definitionId} in ${plan.ecosystem}; ${plan.classification}; ${plan.priority} priority; ${plan.risk} risk; planned at block ${plan.createdAtBlock}.`]
	const inputs = Object.entries(plan.operationInputs ?? {})
	if (inputs.length !== 0) sections.push(`Inputs: ${inputs.map(([key, value]) => `${key} → ${value}`).join('; ')}.`)
	sections.push(plan.steps.length === 0 ? 'No transaction step was planned.' : `Planned transactions: ${plan.steps.map(describeStep).join(' ')}`)
	if (plan.postconditions.length !== 0) sections.push(`Expected outcome: ${plan.postconditions.join('; ')}.`)
	const deadline = isoTimestampFromSeconds(plan.deadlineTimestamp, 'Operation deadline')
	if (deadline !== undefined) sections.push(`Deadline: ${deadline}.`)
	// The published field sanitizer is all-or-nothing, so filter section by section. Operator-supplied
	// plan inputs can contain a URL or path that would otherwise suppress the entire disclosure.
	const publishable = sections.filter(section => safeString(section) !== undefined)
	if (publishable.length !== sections.length) publishable.push('Some planned detail was withheld by the log sanitizer.')
	const details = publishable.join(' ')
	// The published activity field is capped, so truncate here where the cut can be made visible.
	return details.length <= MAXIMUM_PUBLIC_FIELD_LENGTH ? details : `${details.slice(0, MAXIMUM_PUBLIC_FIELD_LENGTH - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`
}

export function recordDryRun(state: Pick<RuntimeState, 'activities'>, plan: OperationPlan) {
	const targets = [...new Set(plan.steps.map(step => step.to))]
	recordActivity(state, {
		details: dryRunDetails(plan),
		ecosystem: plan.ecosystem,
		message: `Dry-run selection: ${plan.label}`,
		operationId: plan.definitionId,
		status: 'dry-run',
		summary: `${plan.steps.length.toString()} step${plan.steps.length === 1 ? '' : 's'} across ${targets.length.toString()} contract${targets.length === 1 ? '' : 's'}; ${plan.risk} risk; ${plan.priority} priority; no transaction signed`,
		type: 'operation',
	})
}

export async function executeScheduledOperation(configuration: ConfigurationState, state: RuntimeState, plan: OperationPlan, execute: () => Promise<void>, recover: (error: unknown) => boolean, trigger: 'scheduled' | 'manual' = 'scheduled') {
	if (trigger === 'manual' && (state.paused || configuration.settings.paused)) throw new Error('Chaos bot is paused')
	const scheduler = schedulerFor(configuration, state)
	await scheduler.begin(plan.definitionId, trigger)
	if (!configuration.settings.runtime.execute) {
		recordDryRun(state, plan)
		await scheduler.complete(plan.definitionId)
		return
	}
	try {
		await execute()
		await scheduler.complete(plan.definitionId)
	} catch (error) {
		if (error instanceof TransactionAwaitingRecovery) throw error
		const recovered = recover(error)
		await scheduler.complete(plan.definitionId)
		if (!recovered) throw error
	}
}

import { getAddress } from '@zoltar/bot-shared/ethereum'
import type { OperationPreflightCall } from '#operations/types'
import { storedInputSources, storedInputValues } from '../operations/input-values.ts'
import { ecosystem, parseEvidenceArray, parseMetadata, parseTerminalSubmission, parseWalletAssetDebits, stringArray } from './durable-record-parsers.ts'
import type { DurableObligation, DurableObligationTombstone, DurableWorkflow, DurableWorkflowStep } from './operator-state.ts'
import { assertExactKeys, dataHex, hash, identifier, nonemptyString, optionalString, optionalTimestamp, positiveIntegerString, requiredRecord, timestamp, unsignedIntegerString } from './validators.ts'

// Validators for durable workflows, their steps, lifecycle obligations, and obligation tombstones.

function parseWorkflowStep(value: unknown, workflowIndex: number, stepIndex: number): DurableWorkflowStep {
	const label = `workflows[${workflowIndex.toString()}].steps[${stepIndex.toString()}]`
	const step = requiredRecord(value, label)
	assertExactKeys(step, ['data', 'evidence', 'gasLimit', 'id', 'label', 'status', 'to', 'value', 'walletAssetDebits'], ['confirmedAt', 'failure', 'failureKind', 'preflightCalls', 'startedAt', 'transactionHash', 'transactionIntentId'], label)
	const status = step['status']
	if (status !== 'blocked' && status !== 'confirmed' && status !== 'failed' && status !== 'planned' && status !== 'signed' && status !== 'submitted') throw new Error(`${label}.status is invalid`)
	const confirmedAt = optionalTimestamp(step['confirmedAt'], `${label}.confirmedAt`)
	const failure = optionalString(step['failure'], `${label}.failure`, 8_192)
	const failureKind = step['failureKind']
	if (failureKind !== undefined && failureKind !== 'nonce-cancelled' && failureKind !== 'receipt-reverted' && failureKind !== 'semantic-failure') {
		throw new Error(`${label}.failureKind is invalid`)
	}
	const startedAt = optionalTimestamp(step['startedAt'], `${label}.startedAt`)
	const transactionHash = step['transactionHash'] === undefined ? undefined : hash(step['transactionHash'], `${label}.transactionHash`)
	const transactionIntentId = step['transactionIntentId'] === undefined ? undefined : identifier(step['transactionIntentId'], `${label}.transactionIntentId`)
	const rawPreflightCalls = step['preflightCalls'] ?? []
	if (!Array.isArray(rawPreflightCalls) || rawPreflightCalls.length > 16) {
		throw new Error(`${label}.preflightCalls must be an array with at most 16 entries`)
	}
	const preflightCalls = rawPreflightCalls.map((candidate, index): OperationPreflightCall => {
		const callLabel = `${label}.preflightCalls[${index.toString()}]`
		const call = requiredRecord(candidate, callLabel)
		assertExactKeys(call, ['caller', 'data', 'expectedResult', 'label', 'to'], ['value'], callLabel)
		const expectedResult = dataHex(call['expectedResult'], `${callLabel}.expectedResult`)
		const value = call['value'] === undefined ? undefined : unsignedIntegerString(call['value'], `${callLabel}.value`)
		return {
			caller: getAddress(nonemptyString(call['caller'], `${callLabel}.caller`)),
			data: dataHex(call['data'], `${callLabel}.data`),
			expectedResult,
			label: nonemptyString(call['label'], `${callLabel}.label`, 512),
			to: getAddress(nonemptyString(call['to'], `${callLabel}.to`)),
			...(value === undefined ? {} : { value }),
		}
	})
	return {
		...(confirmedAt === undefined ? {} : { confirmedAt }),
		data: dataHex(step['data'], `${label}.data`),
		evidence: parseEvidenceArray(step['evidence'], `${label}.evidence`),
		...(failure === undefined ? {} : { failure }),
		...(failureKind === undefined ? {} : { failureKind }),
		gasLimit: positiveIntegerString(step['gasLimit'], `${label}.gasLimit`),
		id: identifier(step['id'], `${label}.id`),
		label: nonemptyString(step['label'], `${label}.label`),
		preflightCalls,
		...(startedAt === undefined ? {} : { startedAt }),
		status,
		to: getAddress(nonemptyString(step['to'], `${label}.to`)),
		...(transactionHash === undefined ? {} : { transactionHash }),
		...(transactionIntentId === undefined ? {} : { transactionIntentId }),
		value: unsignedIntegerString(step['value'], `${label}.value`),
		walletAssetDebits: parseWalletAssetDebits(step['walletAssetDebits'], `${label}.walletAssetDebits`),
	}
}

export function parseWorkflow(value: unknown, index: number): DurableWorkflow {
	const label = `workflows[${index.toString()}]`
	const workflow = requiredRecord(value, label)
	assertExactKeys(
		workflow,
		['classification', 'createdAt', 'createdAtBlock', 'ecosystem', 'id', 'label', 'metadata', 'obligation', 'operationId', 'planId', 'planningSeed', 'postconditions', 'priority', 'risk', 'status', 'steps', 'updatedAt'],
		['operationInputs', 'inputSources', 'completedAt', 'continuationDisposition', 'deadlineTimestamp', 'lastValidBlockNumber', 'maximumCleanupTransactionCount', 'semanticDeadlineBlockNumber', 'startedAt', 'terminalSubmission'],
		label,
	)
	const status = workflow['status']
	if (status !== 'abandoned' && status !== 'blocked' && status !== 'completed' && status !== 'failed' && status !== 'planned' && status !== 'running' && status !== 'waiting-continuation' && status !== 'waiting-obligation' && status !== 'waiting-transaction') throw new Error(`${label}.status is invalid`)
	if (!Array.isArray(workflow['steps']) || workflow['steps'].length === 0) throw new Error(`${label}.steps must be a non-empty array`)
	const completedAt = optionalTimestamp(workflow['completedAt'], `${label}.completedAt`)
	const continuationDisposition = workflow['continuationDisposition']
	if (continuationDisposition !== undefined && continuationDisposition !== 'cleanup-only') {
		throw new Error(`${label}.continuationDisposition is invalid`)
	}
	const startedAt = optionalTimestamp(workflow['startedAt'], `${label}.startedAt`)
	const terminalSubmission = workflow['terminalSubmission'] === undefined ? undefined : parseTerminalSubmission(workflow['terminalSubmission'], `${label}.terminalSubmission`)
	const classification = workflow['classification']
	if (classification !== 'lifecycle-obligation' && classification !== 'selectable') {
		throw new Error(`${label}.classification is invalid`)
	}
	if (continuationDisposition !== undefined && classification !== 'selectable') {
		throw new Error(`${label}.continuationDisposition is only valid for selectable workflows`)
	}
	const priority = workflow['priority']
	if (priority !== 'random' && priority !== 'urgent') {
		throw new Error(`${label}.priority is invalid`)
	}
	const risk = workflow['risk']
	if (risk !== 'low' && risk !== 'medium' && risk !== 'high' && risk !== 'irreversible') {
		throw new Error(`${label}.risk is invalid`)
	}
	if (typeof workflow['obligation'] !== 'boolean') {
		throw new Error(`${label}.obligation must be a boolean`)
	}
	const planningSeed = workflow['planningSeed']
	if (typeof planningSeed !== 'number' || !Number.isSafeInteger(planningSeed) || planningSeed < 0 || planningSeed > 0xffff_ffff) {
		throw new Error(`${label}.planningSeed must be an unsigned 32-bit integer`)
	}
	const maximumCleanupTransactionCount = workflow['maximumCleanupTransactionCount']
	if (maximumCleanupTransactionCount !== undefined && (typeof maximumCleanupTransactionCount !== 'number' || !Number.isSafeInteger(maximumCleanupTransactionCount) || maximumCleanupTransactionCount < 0)) {
		throw new Error(`${label}.maximumCleanupTransactionCount must be a non-negative safe integer`)
	}
	const steps = workflow['steps'].map((step, stepIndex) => parseWorkflowStep(step, index, stepIndex))
	if (new Set(steps.map(step => step.id)).size !== steps.length) throw new Error(`${label}.steps contains duplicate IDs`)
	if (continuationDisposition === 'cleanup-only' && !steps.some(step => step.status === 'confirmed')) {
		throw new Error(`${label}.continuationDisposition requires confirmed on-chain preparation`)
	}
	const terminalStep = steps.at(-1)
	const terminalConfirmation = terminalStep?.evidence.some(evidence => evidence.kind === 'decoded-event-field' && evidence.canonicalLifecycleConfirmation === true) === true
	const earlierConfirmation = steps.slice(0, -1).some(step => step.evidence.some(evidence => evidence.kind === 'decoded-event-field' && evidence.canonicalLifecycleConfirmation === true))
	if ((terminalConfirmation || earlierConfirmation) && (classification !== 'lifecycle-obligation' || workflow['obligation'] !== true)) {
		throw new Error(`${label} uses canonical lifecycle confirmation outside a lifecycle obligation`)
	}
	if (earlierConfirmation) throw new Error(`${label} must declare canonical confirmation only on its terminal step`)
	if (status === 'waiting-obligation') {
		if (classification !== 'lifecycle-obligation' || workflow['obligation'] !== true) throw new Error(`${label} cannot wait for canonical confirmation outside a lifecycle obligation`)
		if (completedAt !== undefined || steps.some(step => step.status !== 'confirmed')) throw new Error(`${label} cannot wait for canonical confirmation with incomplete or completed workflow state`)
		if (!terminalConfirmation) throw new Error(`${label} must declare canonical confirmation only on its terminal step`)
	}
	return {
		classification,
		...(completedAt === undefined ? {} : { completedAt }),
		...(continuationDisposition === undefined ? {} : { continuationDisposition }),
		createdAtBlock: unsignedIntegerString(workflow['createdAtBlock'], `${label}.createdAtBlock`),
		createdAt: timestamp(workflow['createdAt'], `${label}.createdAt`),
		...(workflow['deadlineTimestamp'] === undefined
			? {}
			: {
					deadlineTimestamp: unsignedIntegerString(workflow['deadlineTimestamp'], `${label}.deadlineTimestamp`),
				}),
		ecosystem: ecosystem(workflow['ecosystem'], `${label}.ecosystem`),
		id: identifier(workflow['id'], `${label}.id`),
		label: nonemptyString(workflow['label'], `${label}.label`),
		...(workflow['lastValidBlockNumber'] === undefined
			? {}
			: {
					lastValidBlockNumber: unsignedIntegerString(workflow['lastValidBlockNumber'], `${label}.lastValidBlockNumber`),
				}),
		...(maximumCleanupTransactionCount === undefined ? {} : { maximumCleanupTransactionCount }),
		...(workflow['semanticDeadlineBlockNumber'] === undefined
			? {}
			: {
					semanticDeadlineBlockNumber: unsignedIntegerString(workflow['semanticDeadlineBlockNumber'], `${label}.semanticDeadlineBlockNumber`),
				}),
		metadata: parseMetadata(workflow['metadata'], `${label}.metadata`),
		obligation: workflow['obligation'],
		operationId: identifier(workflow['operationId'], `${label}.operationId`),
		planId: identifier(workflow['planId'], `${label}.planId`),
		planningSeed,
		...(workflow['operationInputs'] === undefined ? {} : { operationInputs: storedInputValues(workflow['operationInputs']) }),
		...(workflow['inputSources'] === undefined ? {} : { inputSources: storedInputSources(workflow['inputSources']) }),
		postconditions: stringArray(workflow['postconditions'], `${label}.postconditions`),
		priority,
		risk,
		...(startedAt === undefined ? {} : { startedAt }),
		status,
		steps,
		...(terminalSubmission === undefined ? {} : { terminalSubmission }),
		updatedAt: timestamp(workflow['updatedAt'], `${label}.updatedAt`),
	}
}

export function parseObligation(value: unknown, index: number): DurableObligation {
	const label = `obligations[${index.toString()}]`
	const obligation = requiredRecord(value, label)
	assertExactKeys(obligation, ['attemptCount', 'blockers', 'createdAt', 'ecosystem', 'id', 'label', 'metadata', 'operationId', 'status', 'updatedAt', 'workflowId'], ['automaticRetryCount', 'completedAt', 'dueAt', 'expiresAt', 'lastAttemptAt', 'lastError', 'notBefore', 'resolvedAt', 'resolutionReason'], label)
	const automaticRetryCount = obligation['automaticRetryCount'] ?? 0
	if (typeof automaticRetryCount !== 'number' || !Number.isSafeInteger(automaticRetryCount) || automaticRetryCount < 0) throw new Error(`${label}.automaticRetryCount is invalid`)
	const attemptCount = obligation['attemptCount']
	if (typeof attemptCount !== 'number' || !Number.isSafeInteger(attemptCount) || attemptCount < 0) throw new Error(`${label}.attemptCount is invalid`)
	const status = obligation['status']
	if (status !== 'abandoned' && status !== 'blocked' && status !== 'completed' && status !== 'deferred' && status !== 'executing' && status !== 'failed' && status !== 'pending') throw new Error(`${label}.status is invalid`)
	const completedAt = optionalTimestamp(obligation['completedAt'], `${label}.completedAt`)
	const dueAt = optionalTimestamp(obligation['dueAt'], `${label}.dueAt`)
	const expiresAt = optionalTimestamp(obligation['expiresAt'], `${label}.expiresAt`)
	const lastAttemptAt = optionalTimestamp(obligation['lastAttemptAt'], `${label}.lastAttemptAt`)
	const lastError = optionalString(obligation['lastError'], `${label}.lastError`, 8_192)
	const notBefore = optionalTimestamp(obligation['notBefore'], `${label}.notBefore`)
	const resolvedAt = optionalTimestamp(obligation['resolvedAt'], `${label}.resolvedAt`)
	const resolutionReason = optionalString(obligation['resolutionReason'], `${label}.resolutionReason`, 2_048)
	if (status === 'abandoned' && (resolvedAt === undefined || resolutionReason === undefined)) {
		throw new Error(`${label} requires resolution metadata while abandoned`)
	}
	if (status !== 'abandoned' && (resolvedAt !== undefined || resolutionReason !== undefined)) {
		throw new Error(`${label} has resolution metadata without abandonment`)
	}
	return {
		automaticRetryCount,
		attemptCount,
		blockers: stringArray(obligation['blockers'], `${label}.blockers`),
		...(completedAt === undefined ? {} : { completedAt }),
		createdAt: timestamp(obligation['createdAt'], `${label}.createdAt`),
		...(dueAt === undefined ? {} : { dueAt }),
		ecosystem: ecosystem(obligation['ecosystem'], `${label}.ecosystem`),
		...(expiresAt === undefined ? {} : { expiresAt }),
		id: identifier(obligation['id'], `${label}.id`),
		label: nonemptyString(obligation['label'], `${label}.label`),
		...(lastAttemptAt === undefined ? {} : { lastAttemptAt }),
		...(lastError === undefined ? {} : { lastError }),
		metadata: parseMetadata(obligation['metadata'], `${label}.metadata`),
		...(notBefore === undefined ? {} : { notBefore }),
		operationId: identifier(obligation['operationId'], `${label}.operationId`),
		...(resolvedAt === undefined ? {} : { resolvedAt }),
		...(resolutionReason === undefined ? {} : { resolutionReason }),
		status,
		updatedAt: timestamp(obligation['updatedAt'], `${label}.updatedAt`),
		workflowId: identifier(obligation['workflowId'], `${label}.workflowId`),
	}
}

export function parseObligationTombstone(value: unknown, index: number): DurableObligationTombstone {
	const label = `obligationTombstones[${index.toString()}]`
	const tombstone = requiredRecord(value, label)
	assertExactKeys(tombstone, ['id', 'resolution', 'resolvedAt', 'resolvedAtBlock'], ['lastSeenBlock', 'observedAbsentAtBlock', 'resolutionReason'], label)
	const resolution = tombstone['resolution']
	if (resolution !== 'abandoned' && resolution !== 'completed') {
		throw new Error(`${label}.resolution is invalid`)
	}
	const resolutionReason = optionalString(tombstone['resolutionReason'], `${label}.resolutionReason`, 2_048)
	if (resolution === 'abandoned' && resolutionReason === undefined) {
		throw new Error(`${label}.resolutionReason is required for abandonment`)
	}
	if (resolution === 'completed' && resolutionReason !== undefined) {
		throw new Error(`${label}.resolutionReason is only valid for abandonment`)
	}
	const resolvedAtBlock = unsignedIntegerString(tombstone['resolvedAtBlock'], `${label}.resolvedAtBlock`)
	const lastSeenBlock = tombstone['lastSeenBlock'] === undefined ? undefined : unsignedIntegerString(tombstone['lastSeenBlock'], `${label}.lastSeenBlock`)
	const observedAbsentAtBlock = tombstone['observedAbsentAtBlock'] === undefined ? undefined : unsignedIntegerString(tombstone['observedAbsentAtBlock'], `${label}.observedAbsentAtBlock`)
	if (lastSeenBlock !== undefined && BigInt(lastSeenBlock) < BigInt(resolvedAtBlock)) {
		throw new Error(`${label}.lastSeenBlock precedes its resolution block`)
	}
	if (observedAbsentAtBlock !== undefined && BigInt(observedAbsentAtBlock) < BigInt(resolvedAtBlock)) {
		throw new Error(`${label}.observedAbsentAtBlock precedes its resolution block`)
	}
	return {
		id: identifier(tombstone['id'], `${label}.id`),
		...(lastSeenBlock === undefined ? {} : { lastSeenBlock }),
		...(observedAbsentAtBlock === undefined ? {} : { observedAbsentAtBlock }),
		resolution,
		resolvedAt: timestamp(tombstone['resolvedAt'], `${label}.resolvedAt`),
		resolvedAtBlock,
		...(resolutionReason === undefined ? {} : { resolutionReason }),
	}
}

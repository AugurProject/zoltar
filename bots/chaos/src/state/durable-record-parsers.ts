import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'
import type { ChaosEcosystem, OperationEvidence, OperationTerminalSubmission, OperationWalletAssetDebit } from '#operations/types'
import type { Activity, DurableLifecyclePresenceBlocker, DurableMetadata, SchedulerState } from './operator-state.ts'
import { assertExactKeys, dataHex, hash, identifier, nonemptyString, optionalString, positiveIntegerString, requiredRecord, timestamp, uint256String, unsignedIntegerString } from './validators.ts'

// Validators for the leaf records of the durable chaos-bot state: evidence, wallet debits, metadata, activities, and the scheduler.

export const MAXIMUM_LIFECYCLE_PRESENCE_BLOCKER_COUNT = 1_000_000

export function parseTerminalSubmission(value: unknown, label: string): OperationTerminalSubmission {
	const submission = requiredRecord(value, label)
	assertExactKeys(submission, ['kind', 'maximumFeePerGas'], [], label)
	if (submission['kind'] !== 'private-next-block') throw new Error(`${label}.kind is invalid`)
	return {
		kind: submission['kind'],
		maximumFeePerGas: uint256String(submission['maximumFeePerGas'], `${label}.maximumFeePerGas`),
	}
}

export function serializedTransaction(value: unknown, label: string) {
	const parsed = dataHex(value, label)
	if (parsed === '0x') throw new Error(`${label} cannot be empty`)
	return parsed
}

export function ecosystem(value: unknown, label: string): ChaosEcosystem {
	if (value !== 'zoltar' && value !== 'statoblast' && value !== 'open-oracle' && value !== 'trading') throw new Error(`${label} is invalid`)
	return value
}

export function stringArray(value: unknown, label: string) {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
	return value.map((candidate, index) => nonemptyString(candidate, `${label}[${index.toString()}]`))
}

export function parseMetadata(value: unknown, label: string): DurableMetadata {
	const record = requiredRecord(value, label)
	if (Object.keys(record).length > 100) throw new Error(`${label} contains too many fields`)
	const parsed: DurableMetadata = {}
	for (const [key, candidate] of Object.entries(record)) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(key)) throw new Error(`${label} contains an invalid key`)
		if (typeof candidate === 'string') parsed[key] = nonemptyString(candidate, `${label}.${key}`, 2_048)
		else if (typeof candidate === 'boolean') parsed[key] = candidate
		else if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) parsed[key] = candidate
		else throw new Error(`${label}.${key} must be a string, boolean, or safe integer`)
	}
	return parsed
}

export function parseLifecyclePresenceBlocker(value: unknown): DurableLifecyclePresenceBlocker {
	const label = 'chaos-bot state.lifecyclePresenceBlocker'
	const blocker = requiredRecord(value, label)
	assertExactKeys(blocker, ['count', 'digest', 'firstDefinitionId', 'firstEcosystem', 'observedAtBlock', 'presenceComplete', 'reason'], ['historyStartBlock', 'requiresCarryHistory'], label)
	const count = blocker['count']
	if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > MAXIMUM_LIFECYCLE_PRESENCE_BLOCKER_COUNT) {
		throw new Error(`${label}.count must be a positive integer within the ${MAXIMUM_LIFECYCLE_PRESENCE_BLOCKER_COUNT.toString()}-identity safety limit`)
	}
	if (typeof blocker['presenceComplete'] !== 'boolean') throw new Error(`${label}.presenceComplete must be a boolean`)
	const historyStartBlock = blocker['historyStartBlock'] === undefined ? undefined : unsignedIntegerString(blocker['historyStartBlock'], `${label}.historyStartBlock`)
	const requiresCarryHistory = blocker['requiresCarryHistory']
	if (requiresCarryHistory !== undefined && (requiresCarryHistory !== true || historyStartBlock === undefined)) throw new Error(`${label}.requiresCarryHistory requires a scoped history boundary`)
	const observedAtBlock = unsignedIntegerString(blocker['observedAtBlock'], `${label}.observedAtBlock`)
	if (historyStartBlock !== undefined && BigInt(historyStartBlock) > BigInt(observedAtBlock)) throw new Error(`${label}.historyStartBlock is after its observation`)
	const reason = blocker['reason']
	if (reason !== 'completed-identity-returned' && reason !== 'unplanned-due-identity') throw new Error(`${label}.reason is invalid`)
	return {
		count,
		digest: hash(blocker['digest'], `${label}.digest`),
		firstDefinitionId: identifier(blocker['firstDefinitionId'], `${label}.firstDefinitionId`),
		firstEcosystem: ecosystem(blocker['firstEcosystem'], `${label}.firstEcosystem`),
		observedAtBlock,
		...(historyStartBlock === undefined ? {} : { historyStartBlock }),
		...(requiresCarryHistory === true ? { requiresCarryHistory: true } : {}),
		presenceComplete: blocker['presenceComplete'],
		reason,
	}
}

function parseEvidence(value: unknown, label: string): OperationEvidence {
	const evidence = requiredRecord(value, label)
	const kind = evidence['kind']
	if (kind === 'receipt-success') {
		assertExactKeys(evidence, ['kind'], [], label)
		return { kind }
	}
	if (kind === 'event') {
		assertExactKeys(evidence, ['emitter', 'kind', 'signature', 'topic0'], [], label)
		return {
			emitter: getAddress(nonemptyString(evidence['emitter'], `${label}.emitter`)),
			kind,
			signature: nonemptyString(evidence['signature'], `${label}.signature`, 512),
			topic0: hash(evidence['topic0'], `${label}.topic0`),
		}
	}
	if (kind === 'decoded-event-field') {
		assertExactKeys(evidence, ['abi', 'emitter', 'equals', 'field', 'indexed', 'kind', 'signature', 'topic0'], ['canonicalLifecycleConfirmation'], label)
		if (evidence['canonicalLifecycleConfirmation'] !== undefined && evidence['canonicalLifecycleConfirmation'] !== true) {
			throw new Error(`${label}.canonicalLifecycleConfirmation must be true when present`)
		}
		const indexed = requiredRecord(evidence['indexed'], `${label}.indexed`)
		if (Object.keys(indexed).length > 32) throw new Error(`${label}.indexed contains too many fields`)
		const parsedIndexed: Record<string, string> = {}
		for (const [key, candidate] of Object.entries(indexed)) {
			if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(key)) throw new Error(`${label}.indexed contains an invalid field name`)
			parsedIndexed[key] = nonemptyString(candidate, `${label}.indexed.${key}`)
		}
		const equals = evidence['equals']
		if (typeof equals !== 'string' && typeof equals !== 'boolean' && !(typeof equals === 'number' && Number.isSafeInteger(equals))) throw new Error(`${label}.equals must be a string, boolean, or safe integer`)
		return {
			abi: nonemptyString(evidence['abi'], `${label}.abi`, 65_536),
			...(evidence['canonicalLifecycleConfirmation'] === true ? { canonicalLifecycleConfirmation: true as const } : {}),
			emitter: getAddress(nonemptyString(evidence['emitter'], `${label}.emitter`)),
			equals,
			field: nonemptyString(evidence['field'], `${label}.field`, 128),
			indexed: parsedIndexed,
			kind,
			signature: nonemptyString(evidence['signature'], `${label}.signature`, 512),
			topic0: hash(evidence['topic0'], `${label}.topic0`),
		}
	}
	if (kind === 'balance-change') {
		assertExactKeys(evidence, ['account', 'asset', 'direction', 'kind'], [], label)
		const direction = evidence['direction']
		if (direction !== 'increase' && direction !== 'decrease' && direction !== 'any') throw new Error(`${label}.direction is invalid`)
		const asset = evidence['asset'] === 'ETH' ? 'ETH' : getAddress(nonemptyString(evidence['asset'], `${label}.asset`))
		return { account: getAddress(nonemptyString(evidence['account'], `${label}.account`)), asset, direction, kind }
	}
	if (kind === 'storage-postcondition') {
		assertExactKeys(evidence, ['abi', 'args', 'contract', 'functionName', 'kind', 'relation'], ['expected'], label)
		const relation = evidence['relation']
		if (relation !== 'changed' && relation !== 'equals' && relation !== 'greater-than' && relation !== 'at-least') throw new Error(`${label}.relation is invalid`)
		const expected = optionalString(evidence['expected'], `${label}.expected`)
		if (relation !== 'changed' && expected === undefined) throw new Error(`${label}.expected is required for ${relation}`)
		return {
			abi: nonemptyString(evidence['abi'], `${label}.abi`, 65_536),
			args: parseStorageArguments(evidence['args'], `${label}.args`),
			contract: getAddress(nonemptyString(evidence['contract'], `${label}.contract`)),
			...(expected === undefined ? {} : { expected }),
			functionName: nonemptyString(evidence['functionName'], `${label}.functionName`, 256),
			kind,
			relation,
		}
	}
	throw new Error(`${label}.kind is invalid`)
}

export function parseStorageArguments(value: unknown, label: string) {
	if (!Array.isArray(value) || value.length > 64) throw new Error(`${label} must be an array with at most 64 entries`)
	return value.map((candidate, index) => {
		if (typeof candidate === 'boolean') return candidate
		return nonemptyString(candidate, `${label}[${index.toString()}]`)
	})
}

export function storageBaselineKey(value: { args: readonly (boolean | string)[]; contract: Address; functionName: string }) {
	return `${value.contract.toLowerCase()}:${value.functionName}:${JSON.stringify(value.args)}`
}

export function parseEvidenceArray(value: unknown, label: string) {
	if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`)
	return value.map((candidate, index) => parseEvidence(candidate, `${label}[${index.toString()}]`))
}

export function parseWalletAssetDebits(value: unknown, label: string): OperationWalletAssetDebit[] {
	if (!Array.isArray(value) || value.length > 256) {
		throw new Error(`${label} must be an array with at most 256 entries`)
	}
	return value.map((candidate, index) => {
		const debitLabel = `${label}[${index.toString()}]`
		const debit = requiredRecord(candidate, debitLabel)
		if (debit['kind'] === 'native') {
			assertExactKeys(debit, ['amount', 'asset', 'kind'], [], debitLabel)
			if (debit['asset'] !== 'ETH') throw new Error(`${debitLabel}.asset must be ETH`)
			return {
				amount: positiveIntegerString(debit['amount'], `${debitLabel}.amount`),
				asset: 'ETH' as const,
				kind: 'native' as const,
			}
		}
		if (debit['kind'] === 'erc20') {
			assertExactKeys(debit, ['amount', 'asset', 'category', 'kind'], [], debitLabel)
			const category = debit['category']
			if (category !== 'rep' && category !== 'weth' && category !== 'lp-token' && category !== 'other') {
				throw new Error(`${debitLabel}.category is invalid`)
			}
			return {
				amount: positiveIntegerString(debit['amount'], `${debitLabel}.amount`),
				asset: getAddress(nonemptyString(debit['asset'], `${debitLabel}.asset`)),
				category,
				kind: 'erc20' as const,
			}
		}
		if (debit['kind'] === 'open-oracle-credit') {
			assertExactKeys(debit, ['amount', 'asset', 'category', 'kind', 'openOracle'], [], debitLabel)
			const category = debit['category']
			if (category !== 'rep' && category !== 'weth' && category !== 'other') {
				throw new Error(`${debitLabel}.category is invalid`)
			}
			const rawAsset = nonemptyString(debit['asset'], `${debitLabel}.asset`)
			return {
				amount: positiveIntegerString(debit['amount'], `${debitLabel}.amount`),
				asset: rawAsset === 'ETH' ? ('ETH' as const) : getAddress(rawAsset),
				category,
				kind: 'open-oracle-credit' as const,
				openOracle: getAddress(nonemptyString(debit['openOracle'], `${debitLabel}.openOracle`)),
			}
		}
		if (debit['kind'] === 'security-pool-vault-rep') {
			assertExactKeys(debit, ['amount', 'category', 'kind', 'pool', 'vault'], [], debitLabel)
			if (debit['category'] !== 'rep') throw new Error(`${debitLabel}.category must be rep`)
			return {
				amount: positiveIntegerString(debit['amount'], `${debitLabel}.amount`),
				category: 'rep' as const,
				kind: 'security-pool-vault-rep' as const,
				pool: getAddress(nonemptyString(debit['pool'], `${debitLabel}.pool`)),
				vault: getAddress(nonemptyString(debit['vault'], `${debitLabel}.vault`)),
			}
		}
		if (debit['kind'] === 'erc1155') {
			assertExactKeys(debit, ['amount', 'asset', 'category', 'kind', 'tokenId'], [], debitLabel)
			if (debit['category'] !== 'outcome-share') {
				throw new Error(`${debitLabel}.category must be outcome-share`)
			}
			return {
				amount: positiveIntegerString(debit['amount'], `${debitLabel}.amount`),
				asset: getAddress(nonemptyString(debit['asset'], `${debitLabel}.asset`)),
				category: 'outcome-share' as const,
				kind: 'erc1155' as const,
				tokenId: unsignedIntegerString(debit['tokenId'], `${debitLabel}.tokenId`),
			}
		}
		throw new Error(`${debitLabel}.kind is invalid`)
	})
}

export function parseActivity(value: unknown, index: number): Activity {
	const label = `activities[${index.toString()}]`
	const activity = requiredRecord(value, label)
	assertExactKeys(activity, ['at', 'message', 'status', 'type'], ['details', 'ecosystem', 'hash', 'operationId', 'summary'], label)
	const type = activity['type']
	if (!['configuration', 'discovery', 'error', 'operation', 'recovery', 'scheduler', 'transaction', 'wallet'].includes(String(type))) throw new Error(`${label}.type is invalid`)
	const status = activity['status']
	if (!['confirmed', 'dry-run', 'failed', 'info', 'pending', 'skipped'].includes(String(status))) throw new Error(`${label}.status is invalid`)
	const details = optionalString(activity['details'], `${label}.details`, 8_192)
	const activityEcosystem = activity['ecosystem'] === undefined ? undefined : ecosystem(activity['ecosystem'], `${label}.ecosystem`)
	const activityHash = activity['hash'] === undefined ? undefined : hash(activity['hash'], `${label}.hash`)
	const operationId = activity['operationId'] === undefined ? undefined : identifier(activity['operationId'], `${label}.operationId`)
	const summary = optionalString(activity['summary'], `${label}.summary`)
	return {
		at: timestamp(activity['at'], `${label}.at`),
		...(details === undefined ? {} : { details }),
		...(activityEcosystem === undefined ? {} : { ecosystem: activityEcosystem }),
		...(activityHash === undefined ? {} : { hash: activityHash }),
		message: nonemptyString(activity['message'], `${label}.message`),
		...(operationId === undefined ? {} : { operationId }),
		status: status as Activity['status'],
		...(summary === undefined ? {} : { summary }),
		type: type as Activity['type'],
	}
}

export function parseScheduler(value: unknown): SchedulerState {
	const scheduler = requiredRecord(value, 'scheduler')
	assertExactKeys(scheduler, ['lastDelaySeconds', 'lastRunAt', 'nextRunAt', 'selectedOperationId', 'status'], [], 'scheduler')
	const lastDelaySeconds = scheduler['lastDelaySeconds']
	if (lastDelaySeconds !== null && (typeof lastDelaySeconds !== 'number' || !Number.isSafeInteger(lastDelaySeconds) || lastDelaySeconds < 60 || lastDelaySeconds > 3_600)) throw new Error('scheduler.lastDelaySeconds is invalid')
	const status = scheduler['status']
	if (status !== 'due' && status !== 'idle' && status !== 'paused' && status !== 'running' && status !== 'scheduled') throw new Error('scheduler.status is invalid')
	const parsed: SchedulerState = {
		lastDelaySeconds: lastDelaySeconds === null ? undefined : lastDelaySeconds,
		lastRunAt: scheduler['lastRunAt'] === null ? undefined : timestamp(scheduler['lastRunAt'], 'scheduler.lastRunAt'),
		nextRunAt: scheduler['nextRunAt'] === null ? undefined : timestamp(scheduler['nextRunAt'], 'scheduler.nextRunAt'),
		selectedOperationId: scheduler['selectedOperationId'] === null ? undefined : identifier(scheduler['selectedOperationId'], 'scheduler.selectedOperationId'),
		status,
	}
	if ((parsed.status === 'due' || parsed.status === 'running' || parsed.status === 'scheduled') && parsed.nextRunAt === undefined) throw new Error(`scheduler.nextRunAt is required while ${parsed.status}`)
	if (parsed.status === 'running' && parsed.selectedOperationId === undefined) throw new Error('scheduler.selectedOperationId is required while running')
	return parsed
}

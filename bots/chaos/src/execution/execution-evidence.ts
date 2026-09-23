import { parseAbiItem } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { OperationEvidence } from '../operations/types.ts'
import { type PendingTransactionIntent } from '../state/operator-state.ts'
import { type BalanceEvidenceObservation, type StorageEvidenceObservation } from './receipt-validation.ts'
import { type ExecutionEnvironment } from './execution-context.ts'
import { agreedEthBalance, agreedTokenBalance, requiredConnectivity, executionReadClients } from './execution-quorum.ts'

export async function captureBalanceEvidence(environment: ExecutionEnvironment, evidence: readonly OperationEvidence[], blockNumber: bigint) {
	const balances = new Map<string, bigint>()
	for (const expectation of evidence) {
		if (expectation.kind !== 'balance-change') continue
		const asset = expectation.asset === 'ETH' ? 'ETH' : expectation.asset.toLowerCase()
		const key = `${expectation.account.toLowerCase()}:${asset}`
		if (balances.has(key)) continue
		const balance = expectation.asset === 'ETH' ? await agreedEthBalance(environment, expectation.account, blockNumber) : await agreedTokenBalance(environment, expectation.asset, expectation.account, blockNumber)
		balances.set(key, balance)
	}
	return balances
}

function storageEvidenceKey(evidence: Pick<Extract<OperationEvidence, { kind: 'storage-postcondition' }>, 'args' | 'contract' | 'functionName'>) {
	return `${evidence.contract.toLowerCase()}:${evidence.functionName}:${JSON.stringify(evidence.args)}`
}

function storageArgument(value: string | boolean, type: string, label: string) {
	if (type === 'bool') {
		if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
		return value
	}
	if (/^u?int\d*$/.test(type)) {
		if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)$/.test(value)) {
			throw new Error(`${label} must be an integer string`)
		}
		return BigInt(value)
	}
	if (typeof value !== 'string') throw new Error(`${label} must be a string`)
	if (type.includes('[') || type.startsWith('tuple')) {
		throw new Error(`${label} uses an unsupported composite storage-evidence argument`)
	}
	return value
}

function storageRead(evidence: Extract<OperationEvidence, { kind: 'storage-postcondition' }>) {
	if (evidence.abi === undefined || evidence.args === undefined) {
		throw new Error(`${evidence.functionName} storage evidence is missing its typed read declaration`)
	}
	const item = parseAbiItem(evidence.abi)
	if (item.type !== 'function' || !('outputs' in item) || !('stateMutability' in item) || item.name !== evidence.functionName) {
		throw new Error(`${evidence.functionName} storage evidence has a mismatched function ABI`)
	}
	if (item.stateMutability !== 'view' && item.stateMutability !== 'pure') {
		throw new Error(`${evidence.functionName} storage evidence must use a read-only function`)
	}
	if (item.outputs.length !== 1) {
		throw new Error(`${evidence.functionName} storage evidence must return one scalar value`)
	}
	if (item.inputs.length !== evidence.args.length) {
		throw new Error(`${evidence.functionName} storage evidence argument count does not match its ABI`)
	}
	return {
		abi: [item],
		args: evidence.args.map((argument, index) => {
			const input = item.inputs[index]
			if (input === undefined) throw new Error(`${evidence.functionName} storage evidence is missing input ${index.toString()}`)
			return storageArgument(argument, input.type, `${evidence.functionName} argument ${index.toString()}`)
		}),
	}
}

function canonicalStorageValue(value: unknown, label: string) {
	if (typeof value === 'bigint' || typeof value === 'number') return String(value)
	if (typeof value === 'boolean') return value ? 'true' : 'false'
	if (typeof value === 'string') return /^0x[0-9a-fA-F]+$/.test(value) ? value.toLowerCase() : value
	throw new Error(`${label} returned a non-scalar storage evidence value`)
}

export async function captureStorageEvidence(environment: ExecutionEnvironment, evidence: readonly OperationEvidence[], blockNumber: bigint) {
	const connectivity = requiredConnectivity(environment.settings)
	const values = new Map<string, string>()
	for (const expectation of evidence) {
		if (expectation.kind !== 'storage-postcondition') continue
		const key = storageEvidenceKey(expectation)
		if (values.has(key)) continue
		const read = storageRead(expectation)
		const value = await settledQuorumValue(
			`${expectation.contract}.${expectation.functionName} storage evidence`,
			executionReadClients(environment).map(async ({ client, endpoint }) => ({
				endpoint,
				value: canonicalStorageValue(
					await client.readContract({
						abi: read.abi,
						address: expectation.contract,
						args: read.args,
						blockNumber,
						functionName: expectation.functionName,
					}),
					`${expectation.contract}.${expectation.functionName}`,
				),
			})),
			connectivity.rpcQuorum,
		)
		values.set(key, value)
	}
	return values
}

export function balanceObservations(evidence: readonly OperationEvidence[], before: ReadonlyMap<string, bigint>, after: ReadonlyMap<string, bigint>): BalanceEvidenceObservation[] {
	return evidence.flatMap(expectation => {
		if (expectation.kind !== 'balance-change') return []
		const asset = expectation.asset === 'ETH' ? 'ETH' : expectation.asset.toLowerCase()
		const key = `${expectation.account.toLowerCase()}:${asset}`
		const beforeBalance = before.get(key)
		const afterBalance = after.get(key)
		if (beforeBalance === undefined || afterBalance === undefined) {
			throw new Error(`Missing captured balance evidence for ${expectation.account}`)
		}
		return [{ after: afterBalance, before: beforeBalance, evidence: expectation }]
	})
}

export function storageObservations(evidence: readonly OperationEvidence[], before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): StorageEvidenceObservation[] {
	return evidence.flatMap(expectation => {
		if (expectation.kind !== 'storage-postcondition') return []
		if (expectation.args === undefined) {
			throw new Error(`${expectation.functionName} storage evidence is missing its arguments`)
		}
		const key = storageEvidenceKey(expectation)
		const beforeValue = before.get(key)
		const afterValue = after.get(key)
		if (beforeValue === undefined || afterValue === undefined) {
			throw new Error(`Missing captured storage evidence for ${expectation.contract}.${expectation.functionName}`)
		}
		return [{ after: afterValue, before: beforeValue, evidence: expectation }]
	})
}

export function durableBalanceBaselines(evidence: readonly OperationEvidence[], balances: ReadonlyMap<string, bigint>): PendingTransactionIntent['semanticExpectation']['balanceBaselines'] {
	return evidence.flatMap(expectation => {
		if (expectation.kind !== 'balance-change') return []
		const assetKey = expectation.asset === 'ETH' ? 'ETH' : expectation.asset.toLowerCase()
		const balance = balances.get(`${expectation.account.toLowerCase()}:${assetKey}`)
		if (balance === undefined) throw new Error(`Missing balance baseline for ${expectation.account}`)
		return [
			{
				account: expectation.account,
				asset: expectation.asset,
				balance: balance.toString(),
			},
		]
	})
}

export function durableStorageBaselines(evidence: readonly OperationEvidence[], values: ReadonlyMap<string, string>): PendingTransactionIntent['semanticExpectation']['storageBaselines'] {
	return evidence.flatMap(expectation => {
		if (expectation.kind !== 'storage-postcondition') return []
		const value = values.get(storageEvidenceKey(expectation))
		if (value === undefined) {
			throw new Error(`Missing storage baseline for ${expectation.contract}.${expectation.functionName}`)
		}
		return [
			{
				args: expectation.args,
				contract: expectation.contract,
				functionName: expectation.functionName,
				value,
			},
		]
	})
}

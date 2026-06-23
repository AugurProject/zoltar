import { readFileSync } from 'node:fs'
import path from 'node:path'

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

export function getRecord(value: unknown, errorMessage: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(errorMessage)
	return value
}

export function getString(value: unknown, errorMessage: string): string {
	if (typeof value !== 'string') throw new Error(errorMessage)
	return value
}

export function getArray(value: unknown, errorMessage: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(errorMessage)
	return value
}

export function loadContractsJson(importMetaDirectory: string): Record<string, unknown> {
	const contractsJsonPath = path.join(importMetaDirectory, '..', '..', 'artifacts', 'Contracts.json')
	return getRecord(JSON.parse(readFileSync(contractsJsonPath, 'utf8')), 'Contracts.json must contain an object root')
}

export function getContractOutput(artifacts: Record<string, unknown>, sourcePath: string, contractName: string): Record<string, unknown> {
	const contracts = getRecord(artifacts.contracts, 'Contracts.json is missing contract outputs')
	const sourceContracts = getRecord(contracts[sourcePath], `Missing compiler output for ${sourcePath}`)
	return getRecord(sourceContracts[contractName], `Missing compiler output for ${contractName}`)
}

export function normalizeStorageType(typeId: string, typeTable: Record<string, unknown>): Record<string, unknown> {
	const typeDefinition = getRecord(typeTable[typeId], `Missing storage type ${typeId}`)
	const normalized: Record<string, unknown> = {
		label: getString(typeDefinition.label, `Missing label for storage type ${typeId}`),
		encoding: getString(typeDefinition.encoding, `Missing encoding for storage type ${typeId}`),
		numberOfBytes: getString(typeDefinition.numberOfBytes, `Missing byte width for storage type ${typeId}`),
	}

	if (typeof typeDefinition.key === 'string') {
		normalized.key = normalizeStorageType(typeDefinition.key, typeTable)
	}
	if (typeof typeDefinition.value === 'string') {
		normalized.value = normalizeStorageType(typeDefinition.value, typeTable)
	}
	if (typeof typeDefinition.base === 'string') {
		normalized.base = normalizeStorageType(typeDefinition.base, typeTable)
	}
	if (Array.isArray(typeDefinition.members)) {
		normalized.members = typeDefinition.members.map((member, index) => {
			const normalizedMember = getRecord(member, `Invalid member ${index} for storage type ${typeId}`)
			const memberType = getString(normalizedMember.type, `Missing member type ${index} for storage type ${typeId}`)
			return {
				label: getString(normalizedMember.label, `Missing member label ${index} for storage type ${typeId}`),
				slot: getString(normalizedMember.slot, `Missing member slot ${index} for storage type ${typeId}`),
				offset: Number(normalizedMember.offset),
				type: normalizeStorageType(memberType, typeTable),
			}
		})
	}

	return normalized
}

export function normalizeStorageLayout(contractOutput: Record<string, unknown>) {
	const storageLayout = getRecord(contractOutput.storageLayout, 'Contract output is missing storageLayout')
	const typeTable = getRecord(storageLayout.types, 'storageLayout is missing types')
	return getArray(storageLayout.storage, 'storageLayout is missing storage').map((entry, index) => {
		const normalizedEntry = getRecord(entry, `Invalid storage entry ${index}`)
		const typeId = getString(normalizedEntry.type, `Missing type for storage entry ${index}`)
		return {
			label: getString(normalizedEntry.label, `Missing label for storage entry ${index}`),
			slot: getString(normalizedEntry.slot, `Missing slot for storage entry ${index}`),
			offset: Number(normalizedEntry.offset),
			type: normalizeStorageType(typeId, typeTable),
		}
	})
}

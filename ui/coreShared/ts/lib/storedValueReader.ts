import { getAddress, isAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { MarketDetails } from '../types/contracts.js'

/** Runtime validation for values read back from browser storage, which may be stale, corrupted, or from another app version. */
export function isStoredRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class StoredValueError extends Error {}

function fail(key: string): never {
	throw new StoredValueError(`Stored value field ${key} is invalid`)
}

export type StoredValueReader = Readonly<{
	address: (key: string) => Address
	bigint: (key: string) => bigint
	boolean: (key: string) => boolean
	number: (key: string) => number
	oneOf: <TValue extends string>(key: string, allowed: readonly TValue[]) => TValue
	optional: <TValue>(key: string, read: (key: string) => TValue) => TValue | undefined
	record: (key: string) => StoredValueReader
	string: (key: string) => string
	stringArray: (key: string) => string[]
}>

function createStoredValueReader(value: unknown): StoredValueReader {
	if (!isStoredRecord(value)) return fail('(root)')
	const record = value
	const reader: StoredValueReader = {
		address: key => {
			const item = record[key]
			if (typeof item !== 'string' || !isAddress(item)) return fail(key)
			return getAddress(item)
		},
		bigint: key => {
			const item = record[key]
			return typeof item === 'bigint' ? item : fail(key)
		},
		boolean: key => {
			const item = record[key]
			return typeof item === 'boolean' ? item : fail(key)
		},
		number: key => {
			const item = record[key]
			return typeof item === 'number' && Number.isFinite(item) ? item : fail(key)
		},
		oneOf: (key, allowed) => {
			const item = record[key]
			const match = allowed.find(candidate => candidate === item)
			return match === undefined ? fail(key) : match
		},
		optional: (key, read) => (record[key] === undefined ? undefined : read(key)),
		record: key => createStoredValueReader(record[key]),
		string: key => {
			const item = record[key]
			return typeof item === 'string' ? item : fail(key)
		},
		stringArray: key => {
			const item = record[key]
			if (!Array.isArray(item)) return fail(key)
			return item.map(entry => (typeof entry === 'string' ? entry : fail(key)))
		},
	}
	return reader
}

/** Builds a typed value from stored data, returning undefined instead of throwing when any field is missing or has the wrong type. */
export function decodeStoredValue<TValue>(value: unknown, build: (reader: StoredValueReader) => TValue): TValue | undefined {
	try {
		return build(createStoredValueReader(value))
	} catch (error) {
		if (error instanceof StoredValueError) return undefined
		throw error
	}
}

export function readStoredMarketDetails(read: StoredValueReader): MarketDetails {
	return {
		answerUnit: read.string('answerUnit'),
		createdAt: read.bigint('createdAt'),
		description: read.string('description'),
		displayValueMax: read.bigint('displayValueMax'),
		displayValueMin: read.bigint('displayValueMin'),
		endTime: read.bigint('endTime'),
		exists: read.boolean('exists'),
		marketType: read.oneOf('marketType', ['binary', 'categorical', 'scalar']),
		numTicks: read.bigint('numTicks'),
		outcomeLabels: read.stringArray('outcomeLabels'),
		questionId: read.string('questionId'),
		startTime: read.bigint('startTime'),
		title: read.string('title'),
	}
}

export function decodeStoredMarketDetails(value: unknown) {
	return decodeStoredValue(value, readStoredMarketDetails)
}

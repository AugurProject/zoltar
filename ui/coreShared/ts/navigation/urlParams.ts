import { tryParseBigIntInput } from '../forms/integerInput.js'
import { parseGenesisOutcome, type GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'

const UNIVERSE_QUERY_PARAM = 'universe'
const SECURITY_POOL_QUESTION_ID_QUERY_PARAM = 'questionId'
const ZOLTAR_VIEW_QUERY_PARAM = 'zoltarView'
/** Universe IDs are `uint248` in every contract, so a larger value can never resolve to a universe. */
const UNIVERSE_ID_LIMIT = 1n << 248n
const GENESIS_QUERY_PARAM = 'genesis'

export function readStringQueryParam(search: string, key: string) {
	const value = new URLSearchParams(search).get(key)
	if (value === null || value.trim() === '') return undefined
	return value
}

/** Applies `mutate` to the parsed search parameters and serializes them back, omitting the `?` when nothing remains. */
export function updateSearchParams(search: string, mutate: (params: URLSearchParams) => void) {
	const params = new URLSearchParams(search)
	mutate(params)
	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}

/** Sets `key` to the trimmed value, or deletes it for an empty value; returns the trimmed value so callers can branch on presence. */
export function setOrDeleteSearchParam(params: URLSearchParams, key: string, value: string | undefined) {
	const trimmed = value?.trim() ?? ''
	if (trimmed === '') {
		params.delete(key)
		return undefined
	}
	params.set(key, trimmed)
	return trimmed
}

function writeStringQueryParam(search: string, key: string, value: string | undefined) {
	return updateSearchParams(search, params => setOrDeleteSearchParam(params, key, value))
}

/** Only the Yes and No branches of the Augur fork are canonical genesis universes. */
export function readGenesisQueryParam(search: string): GenesisOutcome | undefined {
	return parseGenesisOutcome(readStringQueryParam(search, GENESIS_QUERY_PARAM))
}

export function writeGenesisQueryParam(search: string, outcome: GenesisOutcome | undefined) {
	return writeStringQueryParam(search, GENESIS_QUERY_PARAM, outcome)
}

export function readUniverseQueryParam(search: string) {
	const value = readStringQueryParam(search, UNIVERSE_QUERY_PARAM)
	if (value === undefined) return undefined
	const universeId = tryParseBigIntInput(value)
	return universeId !== undefined && universeId >= 0n && universeId < UNIVERSE_ID_LIMIT ? universeId : undefined
}

/** True when `universe` is present but is not a non-negative `uint248` integer, which `readUniverseQueryParam` would otherwise ignore. */
export function hasInvalidUniverseQueryParam(search: string) {
	if (!new URLSearchParams(search).has(UNIVERSE_QUERY_PARAM)) return false
	return readUniverseQueryParam(search) === undefined
}

export function writeUniverseQueryParam(search: string, universeId: bigint | undefined) {
	return writeStringQueryParam(search, UNIVERSE_QUERY_PARAM, universeId?.toString())
}

export function readSecurityPoolQuestionIdQueryParam(search: string) {
	return readStringQueryParam(search, SECURITY_POOL_QUESTION_ID_QUERY_PARAM)
}

export function readZoltarViewQueryParam(search: string) {
	return readStringQueryParam(search, ZOLTAR_VIEW_QUERY_PARAM)
}

export function writeZoltarViewQueryParam(search: string, view: string | undefined) {
	return writeStringQueryParam(search, ZOLTAR_VIEW_QUERY_PARAM, view)
}

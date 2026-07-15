/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { getGenesisReputationTokenAddress } from '../../protocol/activeProtocolAddresses.js'
import {
	bigintToAddress,
	getEscalationSideLabel,
	getForkOutcomeKey,
	getMarketType,
	getMinBigintValue,
	getQuestionId,
	getQuestionIdHex,
	getReportingOutcomeKey,
	getReportingOutcomeValue,
	getSecurityPoolSystemState,
	hasTimestamp,
	hasTimestampAndNumber,
	isBigintTriple,
	isStringArray,
	requireEscalationGameTuple,
	requireOpenOracleExtraDataTuple,
	requireOpenOracleReportMetaTuple,
	requireOpenOracleReportMetaTupleArray,
	requireOpenOracleReportStatusTuple,
	requireOpenOracleReportStatusTupleArray,
	requireUniverseTupleArray,
	requireSecurityVaultTupleArray,
} from '../../protocol/helpers.js'

const questionData = {
	title: 'Test question',
	description: 'Deterministic test question',
	startTime: 1n,
	endTime: 2n,
	numTicks: 0n,
	displayValueMin: 0n,
	displayValueMax: 10n,
	answerUnit: '',
}

describe('contracts helpers', () => {
	test('bigintToAddress pads and normalizes address values', () => {
		expect(bigintToAddress(0n)).toBe(zeroAddress)
		expect(bigintToAddress(1n)).toBe(getAddress('0x0000000000000000000000000000000000000001'))
	})

	test('array type guards cover positives and negatives', () => {
		expect(isStringArray(['Yes', 'No'])).toBe(true)
		expect(isStringArray([1, 2, 3] as unknown[])).toBe(false)
		expect(isBigintTriple([1n, 2n, 3n] as unknown[])).toBe(true)
		expect(isBigintTriple([1n, 2n] as unknown[])).toBe(false)
	})

	test('getMinBigintValue handles empty and non-empty slices', () => {
		expect(getMinBigintValue([])).toBe(undefined)
		expect(getMinBigintValue([7n, 5n, 9n])).toBe(5n)
	})

	test('timestamp predicates validate required keys', () => {
		expect(hasTimestamp({ timestamp: 123n })).toBe(true)
		expect(hasTimestamp({ timestamp: 1 })).toBe(false)
		expect(hasTimestampAndNumber({ timestamp: 1n, number: 2n })).toBe(true)
		expect(hasTimestampAndNumber({ timestamp: 1n })).toBe(false)
	})

	test('tuple validators require exact tuple structure and throw with unexpected responses', () => {
		const validEscalationTuple: [bigint, bigint, bigint, bigint, bigint, [bigint, bigint, bigint], bigint, bigint, bigint, boolean] = [1n, 2n, 3n, 4n, 5n, [6n, 7n, 8n], 9n, 10n, 11n, true]
		expect(requireEscalationGameTuple(validEscalationTuple, 'escalation response')).toEqual(validEscalationTuple)
		expect(() => requireEscalationGameTuple([1n, 2n], 'escalation response')).toThrow('Unexpected escalation response')

		const validUniverseSummary: Array<[bigint, bigint, bigint, `0x${string}`, bigint]> = [[1n, 2n, 3n, getAddress('0x00000000000000000000000000000000000000a1'), 4n]]
		expect(requireUniverseTupleArray(validUniverseSummary, 'universe summary')).toEqual(validUniverseSummary)
		expect(() => requireUniverseTupleArray([[1n, 2n, 3n, getAddress('0x00000000000000000000000000000000000000b2'), 4n, 5n] as never], 'universe summary')).toThrow('Unexpected universe summary response')

		const validVaultTuple: Array<[bigint, bigint, bigint, bigint]> = [[1n, 2n, 3n, 4n]]
		expect(requireSecurityVaultTupleArray(validVaultTuple, 'vault response')).toEqual(validVaultTuple)
		const legacyVaultTuple: Array<[bigint, bigint, bigint, bigint, bigint]> = [[1n, 2n, 3n, 4n, 5n]]
		expect(requireSecurityVaultTupleArray(legacyVaultTuple, 'vault response')).toEqual(legacyVaultTuple)
		expect(() => requireSecurityVaultTupleArray([[1n, 2n, 3n] as never], 'vault response')).toThrow('Unexpected vault response')

		const validMetaTuple: [bigint, bigint, bigint, bigint, `0x${string}`, bigint, `0x${string}`, boolean, bigint, bigint, bigint, bigint] = [1n, 2n, 3n, 4n, getAddress('0x00000000000000000000000000000000000000b2'), 1n, getAddress('0x00000000000000000000000000000000000000c3'), true, 4n, 5n, 6n, 7n]
		const oneValidMetaTuple = [validMetaTuple]
		expect(requireOpenOracleReportMetaTuple(validMetaTuple, 'oracle meta')).toEqual(validMetaTuple)
		expect(requireOpenOracleReportMetaTupleArray(oneValidMetaTuple, 'oracle meta')).toEqual(oneValidMetaTuple)
		expect(() => requireOpenOracleReportMetaTupleArray([[1n, 2n] as never], 'oracle meta')).toThrow('Unexpected oracle meta response')

		const validStatusTuple: [bigint, bigint, `0x${string}`, bigint, bigint, `0x${string}`, bigint] = [1n, 2n, getAddress('0x00000000000000000000000000000000000000d4'), 1n, 2n, getAddress('0x00000000000000000000000000000000000000e5'), 3n]
		expect(requireOpenOracleReportStatusTuple(validStatusTuple, 'oracle status')).toEqual(validStatusTuple)
		expect(requireOpenOracleReportStatusTupleArray([validStatusTuple], 'oracle status')).toEqual([validStatusTuple])
		expect(() => requireOpenOracleReportStatusTupleArray([[1n, 2n] as never], 'oracle status')).toThrow('Unexpected oracle status response')

		const validExtraData: [`0x${string}`, `0x${string}`, bigint, bigint, `0x${string}`, boolean] = ['0x00000000000000000000000000000000000000f6', getAddress('0x00000000000000000000000000000000000000f7'), 1n, 2n, getAddress('0x00000000000000000000000000000000000000f6'), false]
		expect(requireOpenOracleExtraDataTuple(validExtraData, 'oracle extra data')).toEqual(validExtraData)
		expect(() => requireOpenOracleExtraDataTuple(['0x00', zeroAddress, 1] as never, 'oracle extra data')).toThrow('Unexpected oracle extra data response')
	})

	test('question id helpers are deterministic and convert values consistently', () => {
		const outcomes = ['Yes', 'No']
		const idA = getQuestionId(questionData, outcomes)
		const idB = getQuestionId(questionData, outcomes)
		const idDifferent = getQuestionId({ ...questionData, answerUnit: 'USD' }, outcomes)

		expect(idA).toBe(idB)
		expect(idDifferent).not.toBe(idA)
		expect(getQuestionIdHex(idA)).toBe(`0x${idA.toString(16)}`)
	})

	test('mapping helpers cover all enumerations and default/unknown branches', () => {
		expect(getReportingOutcomeValue('invalid')).toBe(0)
		expect(getReportingOutcomeValue('yes')).toBe(1)
		expect(getReportingOutcomeValue('no')).toBe(2)
		expect(() => getReportingOutcomeValue('bad' as never)).toThrow('Unhandled reporting outcome')

		expect(getReportingOutcomeKey(0)).toBe('invalid')
		expect(getReportingOutcomeKey(1n)).toBe('yes')
		expect(getReportingOutcomeKey(2)).toBe('no')
		expect(getReportingOutcomeKey(4)).toBe('none')

		expect(getForkOutcomeKey(0n, zeroAddress)).toBe('none')
		expect(getForkOutcomeKey(1n, getAddress('0x00000000000000000000000000000000000000a1'))).toBe('yes')
		expect(() => getEscalationSideLabel('bad' as never)).toThrow('Unhandled escalation side')
		expect(() => getSecurityPoolSystemState(4)).toThrow('Unhandled security pool system state')
	})

	test('market utilities cover binary and categorical paths', () => {
		expect(getMarketType({ ...questionData, numTicks: 100n }, [])).toBe('scalar')
		expect(getMarketType(questionData, ['Yes', 'No'])).toBe('binary')
		expect(getMarketType(questionData, ['A', 'B', 'C'])).toBe('categorical')
	})

	test('getGenesisReputationTokenAddress is wired through helper defaults', () => {
		expect(getGenesisReputationTokenAddress).toBeInstanceOf(Function)
		const parsed = getGenesisReputationTokenAddress()
		expect(parsed.startsWith('0x')).toBe(true)
		expect(parsed.length).toBe(42)
	})
})

/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { readOpenOracleReportIdQueryParam, readOpenOracleViewQueryParam, writeOpenOracleReportIdQueryParam, writeOpenOracleViewQueryParam } from '../navigation/openOracleUrlParams.js'
import { hasInvalidUniverseQueryParam, readGenesisQueryParam, readSecurityPoolQuestionIdQueryParam, readUniverseQueryParam, readZoltarViewQueryParam, updateSearchParams, writeGenesisQueryParam, writeUniverseQueryParam, writeZoltarViewQueryParam } from '../navigation/urlParams.js'

void describe('url params', () => {
	void test('accepts only Yes and No canonical genesis choices independently of fork universe IDs', () => {
		expect(readGenesisQueryParam('?genesis=yes&universe=12')).toBe('yes')
		expect(readGenesisQueryParam('?genesis=no&universe=0')).toBe('no')
		for (const value of ['', 'invalid', 'repv2', '0', 'YES']) expect(readGenesisQueryParam(`?genesis=${value}`)).toBeUndefined()
		expect(readGenesisQueryParam('?universe=0')).toBeUndefined()
		expect(writeGenesisQueryParam('?universe=12', 'no')).toBe('?universe=12&genesis=no')
		expect(writeGenesisQueryParam('?genesis=yes&universe=12', undefined)).toBe('?universe=12')
	})
	void test('reads a universe query param', () => {
		expect(readUniverseQueryParam('?universe=12')).toBe(12n)
		expect(readUniverseQueryParam('?universe=invalid')).toBe(undefined)
		expect(readUniverseQueryParam('?universe=-1')).toBe(undefined)
		expect(readUniverseQueryParam('')).toBe(undefined)
	})

	void test('rejects universe IDs outside uint256 while preserving the maximum', () => {
		const maximum = (1n << 256n) - 1n
		for (const value of [maximum.toString(), `0x${maximum.toString(16)}`]) expect(readUniverseQueryParam(`?universe=${value}`)).toBe(maximum)
		for (const value of [(maximum + 1n).toString(), `0x${(maximum + 1n).toString(16)}`]) expect(readUniverseQueryParam(`?universe=${value}`)).toBeUndefined()
	})

	void test('flags a present universe query param that is not a non-negative integer', () => {
		expect(hasInvalidUniverseQueryParam('?universe=abc')).toBe(true)
		expect(hasInvalidUniverseQueryParam('?universe=-1')).toBe(true)
		expect(hasInvalidUniverseQueryParam('?universe=')).toBe(true)
		expect(hasInvalidUniverseQueryParam('?universe=0')).toBe(false)
		expect(hasInvalidUniverseQueryParam('?universe=12')).toBe(false)
		expect(hasInvalidUniverseQueryParam('?foo=bar')).toBe(false)
		expect(hasInvalidUniverseQueryParam('')).toBe(false)
	})

	void test('writes a universe query param', () => {
		expect(writeUniverseQueryParam('', 12n)).toBe('?universe=12')
		expect(writeUniverseQueryParam('?foo=bar', 12n)).toBe('?foo=bar&universe=12')
		expect(writeUniverseQueryParam('?foo=bar&universe=12', undefined)).toBe('?foo=bar')
	})

	void test('reads a security pool question id query param', () => {
		expect(readSecurityPoolQuestionIdQueryParam('?questionId=0x42')).toBe('0x42')
		expect(readSecurityPoolQuestionIdQueryParam('?questionId=')).toBe(undefined)
	})

	void test('reads and writes an open oracle report id query param', () => {
		expect(readOpenOracleReportIdQueryParam('?openOracleReportId=42')).toBe('42')
		expect(readOpenOracleReportIdQueryParam('?openOracleReportId=')).toBe(undefined)
		expect(writeOpenOracleReportIdQueryParam('', '42')).toBe('?openOracleReportId=42&openOracleView=selected-report')
		expect(writeOpenOracleReportIdQueryParam('?foo=bar', '42')).toBe('?foo=bar&openOracleReportId=42&openOracleView=selected-report')
		expect(writeOpenOracleReportIdQueryParam('?foo=bar&openOracleReportId=42', undefined)).toBe('?foo=bar')
	})

	void test('reads and writes a zoltar view query param', () => {
		expect(readZoltarViewQueryParam('?zoltarView=questions')).toBe('questions')
		expect(readZoltarViewQueryParam('?zoltarView=')).toBe(undefined)
		expect(writeZoltarViewQueryParam('', 'questions')).toBe('?zoltarView=questions')
		expect(writeZoltarViewQueryParam('?foo=bar', 'questions')).toBe('?foo=bar&zoltarView=questions')
		expect(writeZoltarViewQueryParam('?foo=bar&zoltarView=questions', undefined)).toBe('?foo=bar')
	})

	void test('reads and writes an open oracle view query param', () => {
		expect(readOpenOracleViewQueryParam('?openOracleView=selected-report')).toBe('selected-report')
		expect(readOpenOracleViewQueryParam('?openOracleView=')).toBe(undefined)
		expect(writeOpenOracleViewQueryParam('', 'selected-report')).toBe('?openOracleView=selected-report')
		expect(writeOpenOracleViewQueryParam('?foo=bar', 'selected-report')).toBe('?foo=bar&openOracleView=selected-report')
		expect(writeOpenOracleViewQueryParam('?foo=bar&openOracleView=selected-report', undefined)).toBe('?foo=bar')
		expect(writeOpenOracleViewQueryParam('?openOracleView=selected-report&openOracleReportId=42', 'create')).toBe('?openOracleView=create')
	})

	void test('updateSearchParams serializes mutations and drops the separator when nothing remains', () => {
		expect(updateSearchParams('?a=1', params => params.set('b', '2'))).toBe('?a=1&b=2')
		expect(updateSearchParams('?a=1', params => params.delete('a'))).toBe('')
		expect(updateSearchParams('', () => undefined)).toBe('')
	})
})

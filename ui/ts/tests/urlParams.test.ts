/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import {
	readOpenOracleReportIdQueryParam,
	readOpenOracleViewQueryParam,
	readSecurityPoolsViewQueryParam,
	readSecurityPoolQueryParam,
	readSelectedPoolViewQueryParam,
	readUniverseQueryParam,
	readZoltarViewQueryParam,
	writeOpenOracleReportIdQueryParam,
	writeOpenOracleViewQueryParam,
	writeSecurityPoolsViewQueryParam,
	writeSecurityPoolQueryParam,
	writeSelectedPoolViewQueryParam,
	writeUniverseQueryParam,
	writeZoltarViewQueryParam,
} from '../lib/urlParams.js'

void describe('url params', () => {
	void test('reads a universe query param', () => {
		expect(readUniverseQueryParam('?universe=12')).toBe(12n)
		expect(readUniverseQueryParam('?universe=invalid')).toBe(undefined)
		expect(readUniverseQueryParam('')).toBe(undefined)
	})

	void test('writes a universe query param', () => {
		expect(writeUniverseQueryParam('', 12n)).toBe('?universe=12')
		expect(writeUniverseQueryParam('?foo=bar', 12n)).toBe('?foo=bar&universe=12')
		expect(writeUniverseQueryParam('?foo=bar&universe=12', undefined)).toBe('?foo=bar')
	})

	void test('reads and writes a security pool query param', () => {
		expect(readSecurityPoolQueryParam('?securityPool=0x1234')).toBe('0x1234')
		expect(readSecurityPoolQueryParam('?securityPool=')).toBe(undefined)
		expect(writeSecurityPoolQueryParam('', '0x1234')).toBe('?securityPool=0x1234&securityPoolsView=operate')
		expect(writeSecurityPoolQueryParam('?foo=bar', '0x1234')).toBe('?foo=bar&securityPool=0x1234&securityPoolsView=operate')
		expect(writeSecurityPoolQueryParam('?foo=bar&securityPool=0x1234', undefined)).toBe('?foo=bar')
		expect(writeSecurityPoolQueryParam('?securityPoolsView=create&selectedPoolView=reporting', '0x1234')).toBe('?securityPoolsView=operate&selectedPoolView=reporting&securityPool=0x1234')
		expect(writeSecurityPoolQueryParam('?securityPoolsView=operate&selectedPoolView=reporting&securityPool=0x1234', undefined)).toBe('?securityPoolsView=operate')
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

	void test('reads and writes a security pools view query param', () => {
		expect(readSecurityPoolsViewQueryParam('?securityPoolsView=operate')).toBe('operate')
		expect(readSecurityPoolsViewQueryParam('?securityPoolsView=')).toBe(undefined)
		expect(writeSecurityPoolsViewQueryParam('', 'operate')).toBe('?securityPoolsView=operate')
		expect(writeSecurityPoolsViewQueryParam('?foo=bar', 'operate')).toBe('?foo=bar&securityPoolsView=operate')
		expect(writeSecurityPoolsViewQueryParam('?foo=bar&securityPoolsView=operate', undefined)).toBe('?foo=bar')
		expect(writeSecurityPoolsViewQueryParam('?securityPoolsView=operate&selectedPoolView=staged-operations&securityPool=0x1234', 'create')).toBe('?securityPoolsView=create')
	})

	void test('reads and writes a selected pool view query param', () => {
		expect(readSelectedPoolViewQueryParam('?selectedPoolView=fork-auction')).toBe('fork-auction')
		expect(readSelectedPoolViewQueryParam('?selectedPoolView=')).toBe(undefined)
		expect(writeSelectedPoolViewQueryParam('', 'fork-auction')).toBe('?selectedPoolView=fork-auction&securityPoolsView=operate')
		expect(writeSelectedPoolViewQueryParam('?foo=bar', 'fork-settlement')).toBe('?foo=bar&selectedPoolView=fork-settlement&securityPoolsView=operate')
		expect(writeSelectedPoolViewQueryParam('?foo=bar&selectedPoolView=fork-migration', undefined)).toBe('?foo=bar')
	})

	void test('reads and writes an open oracle view query param', () => {
		expect(readOpenOracleViewQueryParam('?openOracleView=selected-report')).toBe('selected-report')
		expect(readOpenOracleViewQueryParam('?openOracleView=')).toBe(undefined)
		expect(writeOpenOracleViewQueryParam('', 'selected-report')).toBe('?openOracleView=selected-report')
		expect(writeOpenOracleViewQueryParam('?foo=bar', 'selected-report')).toBe('?foo=bar&openOracleView=selected-report')
		expect(writeOpenOracleViewQueryParam('?foo=bar&openOracleView=selected-report', undefined)).toBe('?foo=bar')
		expect(writeOpenOracleViewQueryParam('?openOracleView=selected-report&openOracleReportId=42', 'create')).toBe('?openOracleView=create')
	})
})

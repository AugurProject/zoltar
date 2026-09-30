/// <reference types="bun-types" />

import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getDownloadedStorageKey, resetLocalEntityStoreForTesting, serializeStoredValue, type LocalEntityScope } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { filterOpenOracleReports, openOracleReportDownloadStore, parseReportIdSearch, resolveBrowseStatusFilter, toCachedOpenOracleReportSummary } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/reportBrowse.js'
import { describe, expect, test } from 'bun:test'

function createReport(reportId: bigint, overrides: Partial<OpenOracleReportSummary> = {}): OpenOracleReportSummary {
	return {
		currentAmount1: 10n ** 18n,
		currentAmount2: 3n * 10n ** 18n,
		currentReporter: getAddress('0x3000000000000000000000000000000000000000'),
		disputeOccurred: false,
		exactToken1Report: 10n ** 18n,
		isDistributed: false,
		price: 3n * 10n ** 30n,
		reportId,
		reportTimestamp: 100n,
		settlementTimestamp: 0n,
		timeType: true,
		token1: getAddress('0x2000000000000000000000000000000000000000'),
		token1Decimals: 18,
		token1Symbol: 'REPv2',
		token2: getAddress('0x4000000000000000000000000000000000000000'),
		token2Decimals: 6,
		token2Symbol: 'USDC',
		...overrides,
	}
}

const scope: LocalEntityScope = { app: 'statoblast', kind: 'oracleReport', network: 'test-0x1' }

function writeCachedItems(items: readonly unknown[]) {
	window.localStorage.setItem(getDownloadedStorageKey(scope), serializeStoredValue({ version: 1, items }))
}

void describe('Open Oracle report browse cache', () => {
	installDomTestLifecycle({
		afterTest: () => {
			resetLocalEntityStoreForTesting()
		},
		beforeTest: () => {
			resetLocalEntityStoreForTesting()
		},
	})

	test('reduces opened report details to the browse summary', () => {
		const report = createReport(7n)
		const details: OpenOracleReportDetails = {
			...report,
			callbackContract: zeroAddress,
			callbackGasLimit: 0,
			currentBlockNumber: 5n,
			currentTime: 200n,
			disputeDelay: 60n,
			escalationHalt: 1n,

			feePercentage: 1n,
			initialReporter: undefined,
			lastReportOppoTime: 0n,
			multiplier: 2n,
			numReports: 1n,
			openOracleAddress: getAddress('0x1000000000000000000000000000000000000000'),
			protocolFee: 0n,
			protocolFeeRecipient: zeroAddress,
			settlementTime: 60n,
			settlerRewardAttoEth: 1n,
			stateHash: '0x1234000000000000000000000000000000000000000000000000000000000000',
			trackDisputes: true,
			feesOnlyAtHalt: false,
			flexibleEscalation: false,
		}
		expect(toCachedOpenOracleReportSummary(details)).toEqual(report)
	})

	test('round-trips cached summaries through browser storage, bigints included', () => {
		const report = createReport(12n, { price: 123456789012345678901234567890n })
		openOracleReportDownloadStore.record(scope, [{ data: report, id: '12' }], 1_000)
		resetLocalEntityStoreForTesting()
		expect(openOracleReportDownloadStore.read(scope)).toEqual([{ data: report, fetchedAt: 1_000, id: '12' }])
	})

	test('drops corrupt, incomplete, and statusless cached entries instead of rendering them', () => {
		const valid = createReport(3n)
		const missingSymbol = Object.fromEntries(Object.entries(createReport(4n)).filter(([key]) => key !== 'token2Symbol'))
		writeCachedItems([
			{ data: valid, fetchedAt: 3, id: '3' },
			{ data: missingSymbol, fetchedAt: 4, id: '4' },
			{ data: { ...createReport(5n), reportId: '5' }, fetchedAt: 5, id: '5' },
			{ data: createReport(6n, { reportTimestamp: 0n }), fetchedAt: 6, id: '6' },
			{ data: createReport(7n, { currentReporter: zeroAddress }), fetchedAt: 7, id: '7' },
			{ data: { ...createReport(8n), token1: 'not an address' }, fetchedAt: 8, id: '8' },
			{ data: createReport(0n), fetchedAt: 9, id: '0' },
		])
		expect(openOracleReportDownloadStore.read(scope).map(entry => entry.id)).toEqual(['3'])
	})

	test('filters every downloaded report by status and by ID, symbol, or token address', () => {
		const reports = [createReport(1n), createReport(2n, { disputeOccurred: true }), createReport(3n, { isDistributed: true, token1Symbol: 'DAI' }), createReport(14n, { token2: getAddress('0x00000000000000000000000000000000000000ab') })]
		const ids = (filtered: readonly OpenOracleReportSummary[]) => filtered.map(report => report.reportId)
		expect(ids(filterOpenOracleReports(reports, { normalizedSearchText: '', statusFilter: 'all' }))).toEqual([1n, 2n, 3n, 14n])
		expect(ids(filterOpenOracleReports(reports, { normalizedSearchText: '', statusFilter: 'Pending' }))).toEqual([1n, 14n])
		expect(ids(filterOpenOracleReports(reports, { normalizedSearchText: '', statusFilter: 'Disputed' }))).toEqual([2n])
		expect(ids(filterOpenOracleReports(reports, { normalizedSearchText: '', statusFilter: 'Settled' }))).toEqual([3n])
		expect(ids(filterOpenOracleReports(reports, { normalizedSearchText: 'dai', statusFilter: 'all' }))).toEqual([3n])
		expect(ids(filterOpenOracleReports(reports, { normalizedSearchText: '14', statusFilter: 'all' }))).toEqual([14n])
		expect(ids(filterOpenOracleReports(reports, { normalizedSearchText: '#1', statusFilter: 'all' }))).toEqual([1n, 14n])
		expect(ids(filterOpenOracleReports(reports, { normalizedSearchText: '0x00000000000000000000000000000000000000ab', statusFilter: 'all' }))).toEqual([14n])
		expect(ids(filterOpenOracleReports(reports, { normalizedSearchText: 'dai', statusFilter: 'Pending' }))).toEqual([])
	})

	test('parses a searched report ID and resolves unknown status filters to all', () => {
		expect(parseReportIdSearch(' 42 ')).toBe(42n)
		expect(parseReportIdSearch('#7')).toBe(7n)
		expect(parseReportIdSearch('0')).toBeUndefined()
		expect(parseReportIdSearch('dai')).toBeUndefined()
		expect(parseReportIdSearch('12a')).toBeUndefined()
		expect(resolveBrowseStatusFilter('Settled')).toBe('Settled')
		expect(resolveBrowseStatusFilter('bogus')).toBe('all')
	})
})

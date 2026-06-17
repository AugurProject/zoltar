/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex } from '../lib/pagination.js'

void describe('pagination helpers', () => {
	void test('computes page counts with bigint arithmetic above Number.MAX_SAFE_INTEGER', () => {
		const itemCount = BigInt(Number.MAX_SAFE_INTEGER) * 10n + 1n

		expect(getPaginationPageCount(itemCount, 10)).toBe(9_007_199_254_740_992n)
		expect(formatPaginationSummary(0, getPaginationPageCount(itemCount, 10))).toBe('Page 1 of 9007199254740992')
	})

	void test('compares next-page state without converting page counts to numbers', () => {
		const pageCount = BigInt(Number.MAX_SAFE_INTEGER) + 1n

		expect(getHasNextPaginationPage(Number.MAX_SAFE_INTEGER, pageCount)).toBe(false)
		expect(getHasNextPaginationPage(Number.MAX_SAFE_INTEGER - 1, pageCount)).toBe(true)
	})

	void test('clamps loaded indexes only when the last page is representable as a safe number', () => {
		expect(resolvePaginationPageIndex(3, 2n)).toBe(1)
		expect(resolvePaginationPageIndex(3, BigInt(Number.MAX_SAFE_INTEGER) + 2n)).toBe(3)
	})
})

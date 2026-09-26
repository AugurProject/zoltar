/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { buildLocalBrowseEntries, matchesLocalSearch, normalizeLocalSearchText } from '../lib/localEntityBrowse.js'
import {
	addFavoriteEntry,
	createDownloadedEntityStore,
	getDownloadedStorageKey,
	getFavoritesStorageKey,
	parseDownloadedEntries,
	parseFavoriteEntries,
	parseStoredValue,
	readFavoriteEntries,
	removeFavoriteEntry,
	resetLocalEntityStoreForTesting,
	serializeStoredValue,
	setEntityFavorite,
	subscribeLocalEntityStore,
	upsertDownloadedEntries,
	type LocalEntityScope,
} from '../lib/localEntityStore.js'
import { decodeStoredMarketDetails, decodeStoredValue } from '../lib/storedValueReader.js'
import type { MarketDetails } from '../types/contracts.js'

const scope: LocalEntityScope = { app: 'statoblast', kind: 'pool', network: 'sepolia-0xaa36a7' }

const question: MarketDetails = {
	answerUnit: '',
	createdAt: 1n,
	description: 'Resolution terms',
	displayValueMax: 2n,
	displayValueMin: 0n,
	endTime: 12_345_678_901_234_567_890n,
	exists: true,
	marketType: 'binary',
	numTicks: 2n,
	outcomeLabels: ['Yes', 'No'],
	questionId: '0xabc',
	startTime: 1n,
	title: 'Will it happen?',
}

const decodeNumberRecord = (value: unknown) => decodeStoredValue(value, read => ({ amount: read.bigint('amount') }))

void describe('stored value serialization', () => {
	void test('round-trips bigints, including values above Number.MAX_SAFE_INTEGER', () => {
		const text = serializeStoredValue({ amount: 2n ** 80n, negative: -5n, nested: [{ value: 0n }] })
		expect(parseStoredValue(text)).toEqual({ amount: 2n ** 80n, negative: -5n, nested: [{ value: 0n }] })
	})

	void test('keeps objects that only resemble the bigint tag', () => {
		expect(parseStoredValue('{"$bigint":"12x"}')).toEqual({ $bigint: '12x' })
		expect(parseStoredValue('{"$bigint":"1","other":true}')).toEqual({ $bigint: '1', other: true })
	})

	void test('decodes market details and rejects a record with a wrong field type', () => {
		expect(decodeStoredMarketDetails(parseStoredValue(serializeStoredValue(question)))).toEqual(question)
		expect(decodeStoredMarketDetails({ ...question, endTime: '5' })).toBeUndefined()
		expect(decodeStoredMarketDetails({ ...question, marketType: 'lottery' })).toBeUndefined()
		expect(decodeStoredMarketDetails('not a record')).toBeUndefined()
	})
})

void describe('favorite entries', () => {
	void test('adds newest first, normalizes ids, and keeps the original position when re-added', () => {
		const first = addFavoriteEntry([], '0xAbC', 1)
		const second = addFavoriteEntry(first, '0xDEF', 2)
		expect(second).toEqual([
			{ addedAt: 2, id: '0xdef' },
			{ addedAt: 1, id: '0xabc' },
		])
		expect(addFavoriteEntry(second, '0xabc', 3)).toEqual(second)
		expect(removeFavoriteEntry(second, '0xABC')).toEqual([{ addedAt: 2, id: '0xdef' }])
	})

	void test('caps the favorite list', () => {
		expect(addFavoriteEntry([{ addedAt: 1, id: 'a' }], 'b', 2, 1)).toEqual([{ addedAt: 2, id: 'b' }])
	})

	void test('ignores stored favorites from another version or with invalid entries', () => {
		expect(parseFavoriteEntries({ items: [{ addedAt: 1, id: 'a' }], version: 2 })).toEqual([])
		expect(parseFavoriteEntries({ items: [{ addedAt: 1, id: 'A' }, { addedAt: 2, id: 'a' }, { addedAt: 'x', id: 'b' }, 'junk'], version: 1 })).toEqual([{ addedAt: 1, id: 'a' }])
	})
})

void describe('downloaded entries', () => {
	void test('replaces entries by id and orders them newest fetch first', () => {
		const entries = upsertDownloadedEntries([], [{ data: 1, id: 'A' }], 10, new Set())
		const updated = upsertDownloadedEntries(
			entries,
			[
				{ data: 2, id: 'b' },
				{ data: 3, id: 'a' },
			],
			20,
			new Set(),
		)
		expect(updated).toEqual([
			{ data: 2, fetchedAt: 20, id: 'b' },
			{ data: 3, fetchedAt: 20, id: 'a' },
		])
	})

	void test('evicts the oldest unprotected entries first when over the limit', () => {
		const entries = [
			{ data: 'favorite', fetchedAt: 1, id: 'favorite' },
			{ data: 'old', fetchedAt: 2, id: 'old' },
		]
		expect(upsertDownloadedEntries(entries, [{ data: 'new', id: 'new' }], 3, new Set(['favorite']), 2).map(entry => entry.id)).toEqual(['new', 'favorite'])
	})

	void test('drops stored entries the decoder rejects', () => {
		const stored = parseStoredValue(
			serializeStoredValue({
				items: [
					{ data: { amount: 5n }, fetchedAt: 1, id: 'a' },
					{ data: { amount: 'x' }, fetchedAt: 1, id: 'b' },
				],
				version: 1,
			}),
		)
		expect(parseDownloadedEntries(stored, decodeNumberRecord)).toEqual([{ data: { amount: 5n }, fetchedAt: 1, id: 'a' }])
	})
})

void describe('local browse entries', () => {
	const downloaded = [
		{ data: 'one', fetchedAt: 30, id: 'one' },
		{ data: 'two', fetchedAt: 20, id: 'two' },
		{ data: 'three', fetchedAt: 10, id: 'three' },
	]
	const favorites = [
		{ addedAt: 5, id: 'three' },
		{ addedAt: 4, id: 'missing' },
		{ addedAt: 3, id: 'one' },
	]

	void test('lists favorites in favorite order and skips favorites without a cached summary', () => {
		expect(buildLocalBrowseEntries(downloaded, favorites, 'favorites').map(entry => entry.id)).toEqual(['three', 'one'])
	})

	void test('lists every downloaded summary with its favorite time', () => {
		expect(buildLocalBrowseEntries(downloaded, favorites, 'downloaded').map(entry => [entry.id, entry.favoritedAt])).toEqual([
			['one', 3],
			['two', undefined],
			['three', 5],
		])
	})

	void test('searches case-insensitively over the given fields', () => {
		const query = normalizeLocalSearchText('  WILL ')
		expect(matchesLocalSearch(query, ['0x1', 'Will it happen?'])).toBe(true)
		expect(matchesLocalSearch(query, ['0x1', 'Other'])).toBe(false)
		expect(matchesLocalSearch('', [])).toBe(true)
	})
})

void describe('browser storage', () => {
	installDomTestLifecycle({
		afterTest: () => {
			resetLocalEntityStoreForTesting()
		},
		beforeTest: () => {
			resetLocalEntityStoreForTesting()
		},
	})

	void test('persists favorites per scope and notifies subscribers', () => {
		let notifications = 0
		const unsubscribe = subscribeLocalEntityStore(() => {
			notifications += 1
		})
		setEntityFavorite(scope, '0xAA', true, 7)
		setEntityFavorite(scope, '0xaa', true, 8)
		unsubscribe()
		expect(notifications).toBe(1)
		expect(window.localStorage.getItem(getFavoritesStorageKey(scope))).toBe('{"version":1,"items":[{"id":"0xaa","addedAt":7}]}')
		expect(readFavoriteEntries({ ...scope, network: 'mainnet-0x1' })).toEqual([])

		resetLocalEntityStoreForTesting()
		expect(readFavoriteEntries(scope)).toEqual([{ addedAt: 7, id: '0xaa' }])
	})

	void test('records downloaded summaries that survive a reload and never evict favorites first', () => {
		const store = createDownloadedEntityStore(decodeNumberRecord, 1)
		setEntityFavorite(scope, 'kept', true, 1)
		store.record(scope, [{ data: { amount: 1n }, id: 'kept' }], 1)
		store.record(scope, [{ data: { amount: 2n }, id: 'other' }], 2)
		expect(store.read(scope).map(entry => entry.id)).toEqual(['kept'])

		resetLocalEntityStoreForTesting()
		const reloaded = createDownloadedEntityStore(decodeNumberRecord)
		expect(reloaded.read(scope)).toEqual([{ data: { amount: 1n }, fetchedAt: 1, id: 'kept' }])
		expect(window.localStorage.getItem(getDownloadedStorageKey(scope))).toContain('"$bigint":"1"')
	})

	void test('ignores corrupted storage', () => {
		window.localStorage.setItem(getFavoritesStorageKey(scope), '{not json')
		expect(readFavoriteEntries(scope)).toEqual([])
	})
})

import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { localEntityScopeForNetwork } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { formatQuestionIdHex } from '@zoltar/ui-core-shared/lib/questionId.js'
import { isStoredRecord } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { formatQuestion } from '@zoltar/ui-statoblast-shared/copy/watchlist.js'
import { parseStatoblastPage, statoblastPageHash, type StatoblastPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'

type RecentEntry = { hash: string; title: string; universe: string; opened: number }
const limit = 20

function isRecentEntry(value: unknown): value is RecentEntry {
	return (
		isStoredRecord(value) &&
		typeof value['hash'] === 'string' &&
		typeof value['title'] === 'string' &&
		typeof value['universe'] === 'string' &&
		/^\d{1,75}$/u.test(value['universe']) &&
		BigInt(value['universe']) < 1n << 248n &&
		typeof value['opened'] === 'number' &&
		Number.isSafeInteger(value['opened']) &&
		value['opened'] >= 0
	)
}

function historyHash(page: StatoblastPage) {
	if (page.kind === 'pool') return statoblastPageHash({ kind: 'pool', pool: getAddress(page.pool), tab: 'capital' })
	if (page.kind === 'question') return statoblastPageHash({ kind: 'question', pool: getAddress(page.pool), questionId: page.questionId, tab: 'shares' })
	return undefined
}

function isFallbackTitle(page: StatoblastPage, title: string) {
	if (page.kind === 'pool') return title.toLowerCase() === page.pool.toLowerCase()
	return page.kind === 'question' && (title.toLowerCase() === formatQuestionIdHex(page.questionId) || title === formatQuestion(page.questionId))
}

export function openHistory(profile: NetworkProfile) {
	const scope = localEntityScopeForNetwork(profile, 'statoblast', 'question')
	const storage = getBrowserStorage(scope.persistence === 'session' ? 'sessionStorage' : 'localStorage')
	const key = `zoltar-ui:statoblast:recent:v1:${scope.network}`
	const read = (): RecentEntry[] => {
		try {
			const serialized = storage?.getItem(key)
			if (serialized === undefined || serialized === null) return []
			const data: unknown = JSON.parse(serialized)
			if (!Array.isArray(data)) return []
			const unique = new Map<string, RecentEntry>()
			for (const entry of data.slice(0, limit).filter(isRecentEntry)) {
				const page = parseStatoblastPage(entry.hash)
				const hash = historyHash(page)
				if (hash === undefined) continue
				const universe = BigInt(entry.universe).toString()
				const identity = `${hash}:${universe}`
				const existing = unique.get(identity)
				if (existing === undefined) unique.set(identity, { ...entry, hash, universe })
				else if (isFallbackTitle(page, existing.title) && !isFallbackTitle(page, entry.title)) unique.set(identity, { ...existing, title: entry.title })
			}
			return [...unique.values()]
		} catch (error) {
			if (error instanceof DOMException || error instanceof SyntaxError) return []
			throw error
		}
	}
	const save = (entries: RecentEntry[]) => {
		try {
			storage?.setItem(key, JSON.stringify(entries))
		} catch (error) {
			if (!(error instanceof DOMException)) throw error
		}
	}
	return {
		read,
		add: (page: StatoblastPage, title: string, universeId: bigint) => {
			const hash = historyHash(page)
			if (hash === undefined) return
			const universe = universeId.toString()
			const previous = read()
			const existing = previous.find(entry => entry.hash === hash && entry.universe === universe)
			const fallback = isFallbackTitle(page, title)
			save([{ hash, title: fallback ? (existing?.title ?? title) : title, universe, opened: Date.now() }, ...previous.filter(entry => entry !== existing)].slice(0, limit))
		},
		updateTitle: (page: StatoblastPage, title: string, universeId: bigint) => {
			const hash = historyHash(page)
			if (hash === undefined || isFallbackTitle(page, title)) return
			const universe = universeId.toString()
			const previous = read()
			const existing = previous.find(entry => entry.hash === hash && entry.universe === universe)
			if (existing === undefined || existing.title === title) return
			save(previous.map(entry => (entry === existing ? { ...entry, title } : entry)))
		},
		clear: () => save([]),
	}
}

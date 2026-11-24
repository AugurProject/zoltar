import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { localEntityScopeForNetwork } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { isStoredRecord } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { statoblastPageHash, type StatoblastPage } from '@zoltar/ui-statoblast-shared/lib/routing.js'

type RecentEntry = { hash: string; title: string; universe: string; opened: number }
const limit = 20

function isRecentEntry(value: unknown): value is RecentEntry {
	return isStoredRecord(value) && typeof value['hash'] === 'string' && typeof value['title'] === 'string' && typeof value['universe'] === 'string' && /^\d{1,75}$/u.test(value['universe']) && typeof value['opened'] === 'number'
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
			return Array.isArray(data) ? data.filter(isRecentEntry).slice(0, limit) : []
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
			if (page.kind !== 'pool' && page.kind !== 'question') return
			const hash = statoblastPageHash(page)
			const universe = universeId.toString()
			const previous = read()
			const existing = previous.find(entry => entry.hash === hash && entry.universe === universe)
			const fallback = title.startsWith('0x')
			save([{ hash, title: fallback ? (existing?.title ?? title) : title, universe, opened: Date.now() }, ...previous.filter(entry => entry !== existing)].slice(0, limit))
		},
		clear: () => save([]),
	}
}

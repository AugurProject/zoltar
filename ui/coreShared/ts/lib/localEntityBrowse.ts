import type { DownloadedEntry, FavoriteEntry } from './localEntityStore.js'

export type LocalBrowseCollection = 'favorites' | 'downloaded'

export type LocalBrowseEntry<T> = Readonly<{
	data: T
	favoritedAt: number | undefined
	fetchedAt: number
	id: string
}>

/**
 * Joins cached summaries with favorites. The favorites collection keeps favorite order (newest first); the
 * downloaded collection lists every cached summary, newest fetch first. Favorites without a cached summary are
 * omitted because nothing can be shown for them until they are opened again.
 */
export function buildLocalBrowseEntries<T>(downloaded: readonly DownloadedEntry<T>[], favorites: readonly FavoriteEntry[], collection: LocalBrowseCollection): LocalBrowseEntry<T>[] {
	const favoritedAtById = new Map(favorites.map(entry => [entry.id, entry.addedAt]))
	if (collection === 'downloaded') return downloaded.map(entry => ({ data: entry.data, favoritedAt: favoritedAtById.get(entry.id), fetchedAt: entry.fetchedAt, id: entry.id }))
	const downloadedById = new Map(downloaded.map(entry => [entry.id, entry]))
	return favorites.flatMap(favorite => {
		const entry = downloadedById.get(favorite.id)
		return entry === undefined ? [] : [{ data: entry.data, favoritedAt: favorite.addedAt, fetchedAt: entry.fetchedAt, id: entry.id }]
	})
}

export function normalizeLocalSearchText(text: string) {
	return text.trim().toLowerCase()
}

/** Case-insensitive substring search over the given fields; an empty query matches everything. */
export function matchesLocalSearch(normalizedSearchText: string, fields: readonly string[]) {
	if (normalizedSearchText === '') return true
	return fields.some(field => field.toLowerCase().includes(normalizedSearchText))
}

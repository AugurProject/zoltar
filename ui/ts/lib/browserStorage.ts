export type BrowserStorageName = 'localStorage' | 'sessionStorage'

export function getBrowserStorage(storageName: BrowserStorageName) {
	if (typeof window === 'undefined') return undefined
	try {
		return window[storageName]
	} catch {
		return undefined
	}
}

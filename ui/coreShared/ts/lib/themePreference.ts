import { getBrowserStorage } from './browserStorage.js'

const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

const THEME_STORAGE_KEY = 'zoltar.theme'

type ThemeStorage = {
	getItem(key: string): string | null
	removeItem(key: string): void
	setItem(key: string, value: string): void
}

type ThemeRoot = {
	removeAttribute(name: string): void
	setAttribute(name: string, value: string): void
}

export function parseThemePreference(value: unknown): ThemePreference {
	return THEME_PREFERENCES.find(preference => preference === value) ?? 'system'
}

export function readThemePreference(storage: ThemeStorage | undefined = getBrowserStorage('localStorage')): ThemePreference {
	try {
		return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY))
	} catch (error) {
		if (!(error instanceof DOMException)) throw error
		return 'system'
	}
}

/** Persists the preference; the system preference clears the stored value so the operating system decides again. */
export function saveThemePreference(preference: ThemePreference, storage: ThemeStorage | undefined = getBrowserStorage('localStorage')) {
	if (storage === undefined) return
	try {
		if (preference === 'system') storage.removeItem(THEME_STORAGE_KEY)
		else storage.setItem(THEME_STORAGE_KEY, preference)
	} catch (error) {
		if (!(error instanceof DOMException)) throw error
	}
}

/** tokens.css follows prefers-color-scheme by default; data-theme pins the light or dark palette. */
export function applyThemePreference(preference: ThemePreference, root: ThemeRoot | undefined = typeof document === 'undefined' ? undefined : document.documentElement) {
	if (root === undefined) return
	if (preference === 'system') root.removeAttribute('data-theme')
	else root.setAttribute('data-theme', preference)
}

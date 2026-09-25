import { describe, expect, test } from 'bun:test'
import { applyThemePreference, parseThemePreference, readThemePreference, saveThemePreference } from '../lib/themePreference.js'

function createStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial))
	return {
		getItem: (key: string) => values.get(key) ?? null,
		removeItem: (key: string) => {
			values.delete(key)
		},
		setItem: (key: string, value: string) => {
			values.set(key, value)
		},
		values,
	}
}

function createRoot() {
	const attributes = new Map<string, string>()
	return {
		attributes,
		removeAttribute: (name: string) => {
			attributes.delete(name)
		},
		setAttribute: (name: string, value: string) => {
			attributes.set(name, value)
		},
	}
}

describe('theme preference', () => {
	test('accepts only the known preferences and falls back to the system theme', () => {
		expect(parseThemePreference('light')).toBe('light')
		expect(parseThemePreference('dark')).toBe('dark')
		expect(parseThemePreference('system')).toBe('system')
		expect(parseThemePreference('sepia')).toBe('system')
		expect(parseThemePreference(null)).toBe('system')
	})

	test('persists an explicit theme and clears the stored value for the system theme', () => {
		const storage = createStorage()
		expect(readThemePreference(storage)).toBe('system')
		saveThemePreference('light', storage)
		expect(readThemePreference(storage)).toBe('light')
		saveThemePreference('system', storage)
		expect(storage.values.size).toBe(0)
		expect(readThemePreference(storage)).toBe('system')
	})

	test('reads the system theme when storage is unavailable or blocked', () => {
		expect(readThemePreference(undefined)).toBe('system')
		const blocked = {
			...createStorage(),
			getItem: () => {
				throw new DOMException('blocked', 'SecurityError')
			},
		}
		expect(readThemePreference(blocked)).toBe('system')
	})

	test('pins light or dark with data-theme and removes it to follow the operating system', () => {
		const root = createRoot()
		applyThemePreference('dark', root)
		expect(root.attributes.get('data-theme')).toBe('dark')
		applyThemePreference('light', root)
		expect(root.attributes.get('data-theme')).toBe('light')
		applyThemePreference('system', root)
		expect(root.attributes.has('data-theme')).toBe(false)
	})
})

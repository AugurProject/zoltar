/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { firstRunRoles, persistFirstRunCardDismissed, readFirstRunCardDismissed } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/firstRunRoles.js'

function createMemoryStorage() {
	const values = new Map<string, string>()
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value)
		},
	}
}

function createBlockedStorage() {
	return {
		getItem: (): string | null => {
			throw new DOMException('Storage is disabled', 'SecurityError')
		},
		setItem: () => {
			throw new DOMException('Quota exceeded', 'QuotaExceededError')
		},
	}
}

describe('first-run role guide', () => {
	test('offers one guide link for each role', () => {
		expect(firstRunRoles.map(role => role.id)).toEqual(['vault-provider', 'trader', 'reporter'])
		for (const role of firstRunRoles) {
			expect(role.guideHref.startsWith('https://augurproject.github.io/zoltar/docs/explanation/')).toBe(true)
		}
	})

	test('persists the dismissal', () => {
		const storage = createMemoryStorage()
		expect(readFirstRunCardDismissed(storage)).toBe(false)
		persistFirstRunCardDismissed(storage)
		expect(storage.getItem('statoblast.firstRunRoleGuideDismissed')).toBe('true')
		expect(readFirstRunCardDismissed(storage)).toBe(true)
	})

	test('shows the guide and keeps working when storage is unavailable or blocked', () => {
		expect(readFirstRunCardDismissed(undefined)).toBe(false)
		expect(() => persistFirstRunCardDismissed(undefined)).not.toThrow()
		const blockedStorage = createBlockedStorage()
		expect(readFirstRunCardDismissed(blockedStorage)).toBe(false)
		expect(() => persistFirstRunCardDismissed(blockedStorage)).not.toThrow()
	})

	test('rethrows unexpected storage failures', () => {
		const brokenStorage = {
			getItem: (): string | null => {
				throw new TypeError('broken storage')
			},
			setItem: () => {
				throw new TypeError('broken storage')
			},
		}
		expect(() => readFirstRunCardDismissed(brokenStorage)).toThrow('broken storage')
		expect(() => persistFirstRunCardDismissed(brokenStorage)).toThrow('broken storage')
	})
})

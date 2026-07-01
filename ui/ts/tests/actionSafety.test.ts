import { describe, expect, test } from 'bun:test'
import { ACTION_SAFETY_IDS } from '../lib/actionSafety/ids.js'
import { ACTION_SAFETY_MANIFEST, ACTION_SAFETY_MANIFEST_BY_ID } from '../lib/actionSafety/manifest.js'
import { getActionSafetyPrompt, REQUIRES_CONFIRMATION_ACTION_IDS } from '../lib/actionSafety/runtime.js'
import { evaluateActionSafety } from '../lib/actionSafety/types.js'

describe('action safety manifest', () => {
	test('covers every registered action safety id', () => {
		const manifestIds = ACTION_SAFETY_MANIFEST.map(entry => entry.id)
		expect(new Set(manifestIds).size).toBe(manifestIds.length)
		expect(ACTION_SAFETY_MANIFEST_BY_ID.size).toBe(manifestIds.length)
		expect([...manifestIds].sort()).toEqual([...ACTION_SAFETY_IDS].sort())
	})

	test('keeps the manifest fixtures aligned with the declared guard contract', () => {
		for (const entry of ACTION_SAFETY_MANIFEST) {
			for (const fixture of entry.fixtures) {
				expect(evaluateActionSafety(entry, fixture.state)).toEqual(fixture.expected)
			}
		}
	})

	test('keeps required confirmation ids aligned with runtime prompts', () => {
		expect(new Set(REQUIRES_CONFIRMATION_ACTION_IDS).size).toBe(REQUIRES_CONFIRMATION_ACTION_IDS.length)

		for (const actionSafetyId of REQUIRES_CONFIRMATION_ACTION_IDS) {
			expect(ACTION_SAFETY_MANIFEST_BY_ID.has(actionSafetyId)).toBe(true)
			expect(getActionSafetyPrompt(actionSafetyId)).toBeDefined()
		}
	})
})

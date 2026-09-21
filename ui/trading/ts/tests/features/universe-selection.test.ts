import { describe, expect, test } from 'bun:test'
import { resolveUniverseSelection } from '../../lib/universeSelection.js'

describe('universe selection', () => {
	test('asks discovery for the requested universe but presents nothing until discovery confirms it', () => {
		expect(resolveUniverseSelection(7n, { ids: [], selected: undefined })).toEqual({ requestedUniverseId: '7', confirmedUniverseId: undefined, replaceUrlUniverseId: undefined })
		expect(resolveUniverseSelection(undefined, { ids: [], selected: undefined })).toEqual({ requestedUniverseId: undefined, confirmedUniverseId: undefined, replaceUrlUniverseId: undefined })
	})

	test('confirms a requested universe that discovery found', () => {
		expect(resolveUniverseSelection(2n, { ids: [0n, 2n], selected: 2n })).toEqual({ requestedUniverseId: '2', confirmedUniverseId: '2', replaceUrlUniverseId: undefined })
	})

	test('follows discovery for an absent request without touching the URL', () => {
		expect(resolveUniverseSelection(undefined, { ids: [0n, 2n], selected: 0n })).toEqual({ requestedUniverseId: '0', confirmedUniverseId: '0', replaceUrlUniverseId: undefined })
	})

	test('replaces an unknown request with the universe discovery chose so the URL agrees with the view', () => {
		expect(resolveUniverseSelection(7n, { ids: [0n, 2n], selected: 0n })).toEqual({ requestedUniverseId: '0', confirmedUniverseId: '0', replaceUrlUniverseId: 0n })
	})
})

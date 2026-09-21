import { describe, expect, test } from 'bun:test'
import { resolveUniverseSelection } from '../../lib/universeSelection.js'

describe('universe selection', () => {
	test('asks discovery for the requested universe but presents nothing until discovery confirms it', () => {
		expect(resolveUniverseSelection({ universeId: 7n, present: true }, { ids: [], selected: undefined })).toEqual({ requestedUniverseId: '7', confirmedUniverseId: undefined, replaceUrlUniverseId: undefined })
		expect(resolveUniverseSelection({ universeId: undefined, present: false }, { ids: [], selected: undefined })).toEqual({ requestedUniverseId: undefined, confirmedUniverseId: undefined, replaceUrlUniverseId: undefined })
	})

	test('confirms a requested universe that discovery found', () => {
		expect(resolveUniverseSelection({ universeId: 2n, present: true }, { ids: [0n, 2n], selected: 2n })).toEqual({ requestedUniverseId: '2', confirmedUniverseId: '2', replaceUrlUniverseId: undefined })
	})

	test('follows discovery for an absent request without touching the URL', () => {
		expect(resolveUniverseSelection({ universeId: undefined, present: false }, { ids: [0n, 2n], selected: 0n })).toEqual({ requestedUniverseId: '0', confirmedUniverseId: '0', replaceUrlUniverseId: undefined })
	})

	test('replaces an unknown request with the universe discovery chose so the URL agrees with the view', () => {
		expect(resolveUniverseSelection({ universeId: 7n, present: true }, { ids: [0n, 2n], selected: 0n })).toEqual({ requestedUniverseId: '0', confirmedUniverseId: '0', replaceUrlUniverseId: 0n })
	})

	test('rewrites a malformed request the same way so the URL never keeps a value the routes ignore', () => {
		expect(resolveUniverseSelection({ universeId: undefined, present: true }, { ids: [0n, 2n], selected: 0n })).toEqual({ requestedUniverseId: '0', confirmedUniverseId: '0', replaceUrlUniverseId: 0n })
	})
})

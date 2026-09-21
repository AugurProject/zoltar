import { describe, expect, test } from 'bun:test'
import { resolveUniverseSelection } from '../../lib/universeSelection.js'

describe('universe selection', () => {
	test('asks discovery for the requested universe but presents nothing until discovery confirms it', () => {
		expect(resolveUniverseSelection({ universeId: 7n, present: true, addressed: false }, { ids: [], selected: undefined, forRequest: undefined })).toEqual({ requestedUniverseId: '7', confirmedUniverseId: undefined, replaceUrlUniverseId: undefined })
		expect(resolveUniverseSelection({ universeId: undefined, present: false, addressed: false }, { ids: [], selected: undefined, forRequest: undefined })).toEqual({ requestedUniverseId: undefined, confirmedUniverseId: undefined, replaceUrlUniverseId: undefined })
	})

	test('confirms a requested universe that discovery found', () => {
		expect(resolveUniverseSelection({ universeId: 2n, present: true, addressed: false }, { ids: [0n, 2n], selected: 2n, forRequest: 2n })).toEqual({ requestedUniverseId: '2', confirmedUniverseId: '2', replaceUrlUniverseId: undefined })
	})

	test('follows discovery for an absent request without touching the URL', () => {
		expect(resolveUniverseSelection({ universeId: undefined, present: false, addressed: false }, { ids: [0n, 2n], selected: 0n, forRequest: undefined })).toEqual({ requestedUniverseId: '0', confirmedUniverseId: '0', replaceUrlUniverseId: undefined })
	})

	test('replaces an unknown request with the universe discovery chose so the URL agrees with the view', () => {
		expect(resolveUniverseSelection({ universeId: 7n, present: true, addressed: false }, { ids: [0n, 2n], selected: 0n, forRequest: 7n })).toEqual({ requestedUniverseId: '0', confirmedUniverseId: '0', replaceUrlUniverseId: 0n })
	})

	test('rewrites a malformed request the same way so the URL never keeps a value the routes ignore', () => {
		expect(resolveUniverseSelection({ universeId: undefined, present: true, addressed: false }, { ids: [0n, 2n], selected: 0n, forRequest: undefined })).toEqual({ requestedUniverseId: '0', confirmedUniverseId: '0', replaceUrlUniverseId: 0n })
	})

	test('treats an answer produced for another request as unconfirmed and never rewrites from it', () => {
		// An addressed market reported only its own universe; navigating back to a list route requesting genesis must wait for that route's discovery.
		expect(resolveUniverseSelection({ universeId: 0n, present: true, addressed: false }, { ids: [5n], selected: 5n, forRequest: 5n })).toEqual({ requestedUniverseId: '0', confirmedUniverseId: undefined, replaceUrlUniverseId: undefined })
	})

	test('follows the market on an addressed route and writes its universe into the URL when the parameter disagrees or is missing', () => {
		const live = { ids: [5n], selected: 5n, forRequest: undefined }
		expect(resolveUniverseSelection({ universeId: undefined, present: false, addressed: true }, live)).toEqual({ requestedUniverseId: '5', confirmedUniverseId: '5', replaceUrlUniverseId: 5n })
		expect(resolveUniverseSelection({ universeId: 0n, present: true, addressed: true }, live)).toEqual({ requestedUniverseId: '5', confirmedUniverseId: '5', replaceUrlUniverseId: 5n })
		expect(resolveUniverseSelection({ universeId: 5n, present: true, addressed: true }, live)).toEqual({ requestedUniverseId: '5', confirmedUniverseId: '5', replaceUrlUniverseId: undefined })
		// A genesis market with no parameter is already what the URL means.
		expect(resolveUniverseSelection({ universeId: undefined, present: false, addressed: true }, { ids: [0n], selected: 0n, forRequest: undefined })).toEqual({ requestedUniverseId: '0', confirmedUniverseId: '0', replaceUrlUniverseId: undefined })
	})
})

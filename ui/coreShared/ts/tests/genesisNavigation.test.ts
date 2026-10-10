import { expect, test } from 'bun:test'
import { getGenesisUniverseHref, readGenesisOutcomeFromLocation } from '../navigation/genesisNavigation.js'

test('reads a page choice and gives the hash choice precedence even when it is invalid', () => {
	expect(readGenesisOutcomeFromLocation({ search: '?genesis=yes', hash: '#/zoltar' })).toBe('yes')
	expect(readGenesisOutcomeFromLocation({ search: '?genesis=yes', hash: '#/zoltar?genesis=no' })).toBe('no')
	for (const hash of ['#/zoltar?genesis=', '#/zoltar?genesis=invalid']) expect(readGenesisOutcomeFromLocation({ search: '?genesis=yes', hash })).toBeUndefined()
})

test('initial choice preserves an addressed route and its fork universe', () => {
	const url = new URL(getGenesisUniverseHref('no', false, 'http://localhost/?simulate=1#/market/0x123?genesis=invalid&universe=42'))
	expect(url.searchParams.get('genesis')).toBe('no')
	expect(url.searchParams.get('simulate')).toBe('1')
	expect(url.hash).toBe('#/market/0x123?universe=42')
})

test('switching genesis retires addressed entities, fork IDs, and saved states while keeping the chain environment', () => {
	const url = new URL(
		getGenesisUniverseHref('no', true, 'http://localhost/?genesis=yes&universe=42&simState=saved&simulate=1&simWallet=disconnected&questionId=0x321&securityPool=0x123&vault=0x456&zoltarView=migrate#/pools/0x123/vaults?universe=42&simState=saved&vault=0x456&rpcUrl=https%3A%2F%2Frpc.example&simScenario=deployed'),
	)
	expect(url.search).toBe('?genesis=no&simulate=1&simWallet=disconnected')
	expect(url.hash).toBe('#/?rpcUrl=https%3A%2F%2Frpc.example&simScenario=deployed')
})

test('opening the Augur parent clears both genesis parameters and deployment state before another child is selected', () => {
	const url = new URL(getGenesisUniverseHref(undefined, true, 'http://localhost/?genesis=yes&universe=42&simulate=1&simState=saved#/zoltar?genesis=no&universe=42&simScenario=deployed'))
	expect(url.search).toBe('?simulate=1')
	expect(url.hash).toBe('#/?simScenario=deployed')
	expect(readGenesisOutcomeFromLocation(url)).toBeUndefined()
	const next = new URL(getGenesisUniverseHref('no', false, url.href))
	expect(next.search).toBe('?simulate=1&genesis=no')
	expect(next.hash).toBe('#/?simScenario=deployed')
})

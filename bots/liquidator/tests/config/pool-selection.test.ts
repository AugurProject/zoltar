import { expect, test } from 'bun:test'
import { parseSettings } from '#config/settings'
import { updateSupportedSecurityPool } from '#config/pool-selection'
import { parseSecurityPoolSelections } from '#config/security-pool-policy'

const address = '0x1111111111111111111111111111111111111111'
const sibling = '0x2222222222222222222222222222222222222222'

test('adds and removes support without changing sibling selections, approvals, or execution mode', async () => {
	const settings = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	settings.selectedSecurityPools = [{ address: sibling, universeId: 1n }]
	const request = { address, universeId: '0', chainId: settings.network.chainId, supported: true }
	const added = updateSupportedSecurityPool(settings, request)
	expect(added.selectedSecurityPools).toEqual([
		{ address: sibling, universeId: 1n },
		{ address, universeId: 0n },
	])
	expect(updateSupportedSecurityPool(added, request).selectedSecurityPools).toEqual([
		{ address: sibling, universeId: 1n },
		{ address, universeId: 0n },
	])
	expect(added.approvedUniverses).toEqual(settings.approvedUniverses)
	expect(added.runtime.execute).toBe(settings.runtime.execute)
	expect(updateSupportedSecurityPool(added, { ...request, supported: false }).selectedSecurityPools).toEqual([{ address: sibling, universeId: 1n }])
	expect(() => updateSupportedSecurityPool(added, { ...request, chainId: -1 })).toThrow('different chain')
	expect(() => updateSupportedSecurityPool(added, { ...request, address: 'broken' })).toThrow()
})

test('selections distinguish universes and reject malformed scopes', () => {
	expect(
		parseSecurityPoolSelections([
			{ address, universeId: '0' },
			{ address, universeId: '1' },
		]),
	).toEqual([
		{ address, universeId: 0n },
		{ address, universeId: 1n },
	])
	expect(() => parseSecurityPoolSelections([{ address, universeId: '-1' }])).toThrow('uint248')
	expect(() => parseSecurityPoolSelections({})).toThrow('security pool/universe selections')
})

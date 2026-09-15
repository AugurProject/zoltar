import { expect, test } from 'bun:test'
import { parseSettings } from '#config/settings'
import { parsePoolSelection, updateSupportedPool } from '#config/pool-selection'

const address = '0x1111111111111111111111111111111111111111'
const sibling = '0x2222222222222222222222222222222222222222'

test('adds and removes support without changing sibling selections, approvals, or execution mode', async () => {
	const settings = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	settings.selectedPools = [sibling]
	const request = { address, chainId: settings.network.chainId, supported: true }
	const added = updateSupportedPool(settings, request)
	expect(added.selectedPools).toEqual([sibling, address])
	expect(updateSupportedPool(added, request).selectedPools).toEqual([sibling, address])
	expect(added.approvedUniverses).toEqual(settings.approvedUniverses)
	expect(added.runtime.execute).toBe(settings.runtime.execute)
	expect(updateSupportedPool(added, { ...request, supported: false }).selectedPools).toEqual([sibling])
	expect(() => updateSupportedPool(added, { ...request, chainId: -1 })).toThrow('different chain')
	expect(() => updateSupportedPool(added, { ...request, address: 'broken' })).toThrow()
})

test('validates and deduplicates the monitored table full-set selection', () => {
	expect(parsePoolSelection([address, sibling, address])).toEqual([address, sibling])
	expect(() => parsePoolSelection([42])).toThrow('addresses')
	expect(() => parsePoolSelection({})).toThrow('array')
})

import { expect, test } from 'bun:test'
import { parseSettings } from '#config/settings'
import { updateSupportedPortfolio } from '#config/pool-selection'
import { parsePortfolioSelections } from '#config/portfolio-policy'

const address = '0x1111111111111111111111111111111111111111'
const sibling = '0x2222222222222222222222222222222222222222'

test('adds and removes support without changing sibling selections, approvals, or execution mode', async () => {
	const settings = parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
	settings.selectedPortfolios = [{ address: sibling, universeId: 1n }]
	const request = { address, universeId: '0', chainId: settings.network.chainId, supported: true }
	const added = updateSupportedPortfolio(settings, request)
	expect(added.selectedPortfolios).toEqual([
		{ address: sibling, universeId: 1n },
		{ address, universeId: 0n },
	])
	expect(updateSupportedPortfolio(added, request).selectedPortfolios).toEqual([
		{ address: sibling, universeId: 1n },
		{ address, universeId: 0n },
	])
	expect(added.approvedUniverses).toEqual(settings.approvedUniverses)
	expect(added.runtime.execute).toBe(settings.runtime.execute)
	expect(updateSupportedPortfolio(added, { ...request, supported: false }).selectedPortfolios).toEqual([{ address: sibling, universeId: 1n }])
	expect(() => updateSupportedPortfolio(added, { ...request, chainId: -1 })).toThrow('different chain')
	expect(() => updateSupportedPortfolio(added, { ...request, address: 'broken' })).toThrow()
})

test('selections distinguish universes and reject malformed scopes', () => {
	expect(
		parsePortfolioSelections([
			{ address, universeId: '0' },
			{ address, universeId: '1' },
		]),
	).toEqual([
		{ address, universeId: 0n },
		{ address, universeId: 1n },
	])
	expect(() => parsePortfolioSelections([{ address, universeId: '-1' }])).toThrow('uint248')
	expect(() => parsePortfolioSelections({})).toThrow('portfolio/universe selections')
})

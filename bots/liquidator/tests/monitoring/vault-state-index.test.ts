import { describe, expect, test } from 'bun:test'
import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { createVaultStateIndex, refreshVaultStateIndex } from '../../src/monitoring/vault-state-index.ts'

type Position = Readonly<{ address: Address; rep: bigint }>

function address(index: number) {
	return getAddress(`0x${index.toString(16).padStart(40, '0')}`)
}

describe('liquidator active-vault state index', () => {
	test('indexes more than 1,000 vaults while retaining and refreshing only REP-backed positions', async () => {
		const registry = Array.from({ length: 1_505 }, (_value, index) => address(index + 1))
		const positions = new Map(registry.map((vault, index) => [vault.toLowerCase(), { address: vault, rep: index % 300 === 0 ? 1n : 0n } satisfies Position]))
		const index = createVaultStateIndex<Position>()
		const loadedPages: Address[][] = []
		const first = await refreshVaultStateIndex(index, {
			block: { hash: `0x${'11'.repeat(32)}`, number: 10n },
			hasRep: position => position.rep > 0n,
			knownVaultCount: BigInt(registry.length),
			loadChangedVaultAddresses: async () => [],
			loadPositions: async vaults => {
				loadedPages.push([...vaults])
				return vaults.map(vault => positions.get(vault.toLowerCase()) ?? { address: vault, rep: 0n })
			},
			loadRegistryRange: async (start, count) => registry.slice(Number(start), Number(start + count)),
			readCanonicalBlockHash: async () => `0x${'11'.repeat(32)}`,
		})
		expect(loadedPages.reduce((total, page) => total + page.length, 0)).toBe(1_505)
		expect(first).toHaveLength(6)
		expect(index.activeVaultCount).toBe(6)

		const reactivated = registry[1]
		if (reactivated === undefined) throw new Error('reactivation fixture is missing')
		positions.set(reactivated.toLowerCase(), { address: reactivated, rep: 2n })
		loadedPages.length = 0
		const second = await refreshVaultStateIndex(index, {
			block: { hash: `0x${'22'.repeat(32)}`, number: 11n },
			hasRep: position => position.rep > 0n,
			knownVaultCount: BigInt(registry.length),
			loadChangedVaultAddresses: async () => [reactivated],
			loadPositions: async vaults => {
				loadedPages.push([...vaults])
				return vaults.map(vault => positions.get(vault.toLowerCase()) ?? { address: vault, rep: 0n })
			},
			loadRegistryRange: async () => {
				throw new Error('unchanged registry must not be rescanned')
			},
			readCanonicalBlockHash: async () => `0x${'11'.repeat(32)}`,
		})
		expect(loadedPages.reduce((total, page) => total + page.length, 0)).toBe(7)
		expect(second).toHaveLength(7)
		expect(index.activeVaultCount).toBe(7)

		const appended = address(2_000)
		registry.push(appended)
		positions.set(appended.toLowerCase(), { address: appended, rep: 3n })
		const registryReads: Array<{ start: bigint; count: bigint }> = []
		const third = await refreshVaultStateIndex(index, {
			block: { hash: `0x${'33'.repeat(32)}`, number: 12n },
			hasRep: position => position.rep > 0n,
			knownVaultCount: BigInt(registry.length),
			loadChangedVaultAddresses: async () => [],
			loadPositions: async vaults => vaults.map(vault => positions.get(vault.toLowerCase()) ?? { address: vault, rep: 0n }),
			loadRegistryRange: async (start, count) => {
				registryReads.push({ start, count })
				return registry.slice(Number(start), Number(start + count))
			},
			readCanonicalBlockHash: async () => `0x${'22'.repeat(32)}`,
		})
		expect(registryReads).toEqual([{ start: 1_505n, count: 1n }])
		expect(third.some(position => position.address === appended)).toBeTrue()
		expect(index.activeVaultCount).toBe(8)
	})
})

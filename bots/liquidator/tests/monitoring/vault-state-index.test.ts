import { describe, expect, test } from 'bun:test'
import { createVaultStateIndex, refreshVaultStateIndex } from '../../src/monitoring/vault-state-index.ts'
import { getAddress, type Address } from '../helpers/ethereum.ts'

type Position = Readonly<{ address: Address; rep: bigint }>

function address(index: number) {
	return getAddress(`0x${index.toString(16).padStart(40, '0')}`)
}

function newestFirstRegistryPage(registry: readonly Address[], start: bigint, count: bigint) {
	const page: Address[] = []
	for (let offset = 0n; offset < count && start + offset < BigInt(registry.length); offset++) {
		const vault = registry[registry.length - Number(start + offset) - 1]
		if (vault === undefined) throw new Error('registry fixture is missing a vault')
		page.push(vault)
	}
	return page
}

describe('liquidator active-vault state index', () => {
	test('rejects a first scan reorg without publishing its vault snapshot', async () => {
		const vault = address(1)
		const index = createVaultStateIndex<Position>()
		const originalHash = `0x${'11'.repeat(32)}` as const
		const replacementHash = `0x${'22'.repeat(32)}` as const
		let canonicalHash = originalHash
		await expect(
			refreshVaultStateIndex(index, {
				block: { hash: originalHash, number: 10n },
				hasRep: position => position.rep > 0n,
				knownVaultCount: 1n,
				loadChangedVaultAddresses: async () => [vault],
				loadPositions: async vaults => {
					canonicalHash = replacementHash
					return vaults.map(address => ({ address, rep: 1n }))
				},
				loadRegistryRange: async () => [vault],
				readCanonicalBlockHash: async () => canonicalHash,
			}),
		).rejects.toThrow('vault snapshot changed during refresh')
		expect(index).toEqual(createVaultStateIndex<Position>())
	})

	test('rejects an incremental reorg without changing the prior vault index', async () => {
		const vault = address(1)
		const originalHash = `0x${'11'.repeat(32)}` as const
		const nextHash = `0x${'22'.repeat(32)}` as const
		const replacementHash = `0x${'33'.repeat(32)}` as const
		const index = createVaultStateIndex<Position>()
		await refreshVaultStateIndex(index, {
			block: { hash: originalHash, number: 10n },
			hasRep: position => position.rep > 0n,
			knownVaultCount: 1n,
			loadChangedVaultAddresses: async () => [],
			loadPositions: async vaults => vaults.map(address => ({ address, rep: 1n })),
			loadRegistryRange: async () => [vault],
			readCanonicalBlockHash: async () => originalHash,
		})
		const previousVaults = index.activeVaults
		let currentHash = nextHash
		await expect(
			refreshVaultStateIndex(index, {
				block: { hash: nextHash, number: 11n },
				hasRep: position => position.rep > 0n,
				knownVaultCount: 1n,
				loadChangedVaultAddresses: async () => [vault],
				loadPositions: async vaults => {
					currentHash = replacementHash
					return vaults.map(address => ({ address, rep: 2n }))
				},
				loadRegistryRange: async () => [],
				readCanonicalBlockHash: async blockNumber => (blockNumber === 10n ? originalHash : currentHash),
			}),
		).rejects.toThrow('vault snapshot changed during refresh')
		expect(index.activeVaults).toBe(previousVaults)
		expect(index.blockHash).toBe(originalHash)
		expect(index.blockNumber).toBe(10n)
		expect(index.knownVaultCount).toBe(1n)
		expect(index.activeVaults.get(vault.toLowerCase())?.rep).toBe(1n)
	})

	test('indexes more than 1,000 vaults while retaining and refreshing only REP-backed positions', async () => {
		const registry = Array.from({ length: 1_506 }, (_value, index) => address(index + 1))
		const positions = new Map(registry.map((vault, index) => [vault.toLowerCase(), { address: vault, rep: index === 1_505 ? 0n : 1n } satisfies Position]))
		const index = createVaultStateIndex<Position>()
		const loadedPages: Address[][] = []
		const { activeVaults: first } = await refreshVaultStateIndex(index, {
			block: { hash: `0x${'11'.repeat(32)}`, number: 10n },
			hasRep: position => position.rep > 0n,
			knownVaultCount: BigInt(registry.length),
			loadChangedVaultAddresses: async () => [],
			loadPositions: async vaults => {
				loadedPages.push([...vaults])
				return vaults.map(vault => positions.get(vault.toLowerCase()) ?? { address: vault, rep: 0n })
			},
			loadRegistryRange: async (start, count) => newestFirstRegistryPage(registry, start, count),
			readCanonicalBlockHash: async blockNumber => (blockNumber === 10n ? `0x${'11'.repeat(32)}` : `0x${'22'.repeat(32)}`),
		})
		expect(loadedPages.reduce((total, page) => total + page.length, 0)).toBe(1_506)
		expect(first).toHaveLength(1_505)
		expect(index.activeVaultCount).toBe(1_505)

		const reactivated = registry.at(-1)
		if (reactivated === undefined) throw new Error('reactivation fixture is missing')
		positions.set(reactivated.toLowerCase(), { address: reactivated, rep: 2n })
		loadedPages.length = 0
		const { activeVaults: second } = await refreshVaultStateIndex(index, {
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
			readCanonicalBlockHash: async blockNumber => (blockNumber === 10n ? `0x${'11'.repeat(32)}` : `0x${'22'.repeat(32)}`),
		})
		expect(loadedPages.reduce((total, page) => total + page.length, 0)).toBe(1)
		expect(second).toHaveLength(1_506)
		expect(index.activeVaultCount).toBe(1_506)

		const emptied = registry[0]
		if (emptied === undefined) throw new Error('eviction fixture is missing')
		positions.set(emptied.toLowerCase(), { address: emptied, rep: 0n })
		loadedPages.length = 0
		const { activeVaults: third } = await refreshVaultStateIndex(index, {
			block: { hash: `0x${'33'.repeat(32)}`, number: 12n },
			hasRep: position => position.rep > 0n,
			knownVaultCount: BigInt(registry.length),
			loadChangedVaultAddresses: async () => [emptied],
			loadPositions: async vaults => {
				loadedPages.push([...vaults])
				return vaults.map(vault => positions.get(vault.toLowerCase()) ?? { address: vault, rep: 0n })
			},
			loadRegistryRange: async () => {
				throw new Error('unchanged registry must not be rescanned')
			},
			readCanonicalBlockHash: async blockNumber => (blockNumber === 11n ? `0x${'22'.repeat(32)}` : `0x${'33'.repeat(32)}`),
		})
		expect(loadedPages.reduce((total, page) => total + page.length, 0)).toBe(1)
		expect(third.some(position => position.address === emptied)).toBeFalse()
		expect(index.activeVaultCount).toBe(1_505)

		const appended = address(2_000)
		registry.push(appended)
		positions.set(appended.toLowerCase(), { address: appended, rep: 3n })
		const registryReads: Array<{ start: bigint; count: bigint }> = []
		const { activeVaults: fourth } = await refreshVaultStateIndex(index, {
			block: { hash: `0x${'44'.repeat(32)}`, number: 13n },
			hasRep: position => position.rep > 0n,
			knownVaultCount: BigInt(registry.length),
			loadChangedVaultAddresses: async () => [],
			loadPositions: async vaults => vaults.map(vault => positions.get(vault.toLowerCase()) ?? { address: vault, rep: 0n }),
			loadRegistryRange: async (start, count) => {
				registryReads.push({ start, count })
				return newestFirstRegistryPage(registry, start, count)
			},
			readCanonicalBlockHash: async blockNumber => (blockNumber === 12n ? `0x${'33'.repeat(32)}` : `0x${'44'.repeat(32)}`),
		})
		expect(registryReads).toEqual([{ start: 0n, count: 1n }])
		expect(fourth.some(position => position.address === appended)).toBeTrue()
		expect(index.activeVaultCount).toBe(1_506)

		loadedPages.length = 0
		registryReads.length = 0
		await refreshVaultStateIndex(index, {
			block: { hash: `0x${'55'.repeat(32)}`, number: 14n },
			hasRep: position => position.rep > 0n,
			knownVaultCount: BigInt(registry.length),
			loadChangedVaultAddresses: async () => {
				throw new Error('reorg reset must rebuild from the registry')
			},
			loadPositions: async vaults => {
				loadedPages.push([...vaults])
				return vaults.map(vault => positions.get(vault.toLowerCase()) ?? { address: vault, rep: 0n })
			},
			loadRegistryRange: async (start, count) => {
				registryReads.push({ start, count })
				return newestFirstRegistryPage(registry, start, count)
			},
			readCanonicalBlockHash: async blockNumber => (blockNumber === 13n ? `0x${'66'.repeat(32)}` : `0x${'55'.repeat(32)}`),
		})
		expect(registryReads[0]).toEqual({ start: 0n, count: 100n })
		expect(loadedPages.reduce((total, page) => total + page.length, 0)).toBe(1_507)
		expect(index.activeVaultCount).toBe(1_506)
	})
})

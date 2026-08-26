import { chmod, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { encodeAbiParameters, getAddress, keccak256 } from '@zoltar/bot-shared/ethereum'
import type { ChaosProtocolIndex } from '../../src/monitoring/protocol-index.ts'
import { initialDurableState, loadDurableState, saveDurableState, serializedDurableState, type StateFilesystem } from '../../src/state/operator-state.ts'
import { MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES, MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS, parseProtocolIndex, protocolIndexSidecarDirectory } from '../../src/state/protocol-index-store.ts'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function statePath() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-index-'))
	directories.push(directory)
	return join(directory, 'state.json')
}

function address(value: number) {
	return getAddress(`0x${value.toString(16).padStart(40, '0')}`)
}

function childUniverseId(universeId: string, outcomeIndex: string) {
	return (BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [BigInt(universeId), BigInt(outcomeIndex)]))) & ((1n << 248n) - 1n)).toString()
}

function report(openOracle: `0x${string}`) {
	return {
		currentAmount1: '10',
		currentAmount2: '20',
		currentReporter: address(23),
		disputeAfterTimestamp: '160',
		disputeBeforeTimestamp: '1000',
		disputeDelay: '60',
		escalationHalt: '1000',
		flags: 1,
		game: {
			callbackContract: address(0),
			callbackGasLimit: 0,
			feePercentage: 1,
			lastReportOppoTime: '0',
			numReports: 1,
			protocolFee: 2,
			protocolFeeRecipient: address(24),
			settlerReward: '3',
		},
		helper: { blockNumber: '40', blockTimestamp: '100', creator: address(25) },
		multiplier: 140,
		openOracle,
		reportId: '4',
		reportTimestamp: '100',
		settleAfterTimestamp: '1000',
		settlementTime: '900',
		settlementTimestamp: '0',
		stateHash: `0x${'55'.repeat(32)}` as const,
		token1: address(26),
		token2: address(27),
	}
}

function protocolIndex(cursorBlockNumber = '50', cursorByte = '44'): ChaosProtocolIndex {
	const openOracle = address(20)
	return {
		auctionBids: {
			[openOracle.toLowerCase()]: [{ amountAttoEth: 25n.toString(), index: '2', refunded: false, tick: '-7' }],
		},
		chainId: 1,
		childRepSplits: [{ childPoolRepSplitAttoRep: 45n.toString(), outcomeIndex: '1', pool: openOracle }],
		cursor: { blockHash: `0x${cursorByte.repeat(32)}`, blockNumber: cursorBlockNumber },
		escalationDeposits: [
			{
				amountAttoRep: 90n.toString(),
				claimed: false,
				depositIndex: '3',
				escalationGame: openOracle,
				outcome: 1,
				parentDepositIndex: '8',
				pool: address(21),
				vault: address(22),
			},
		],
		migrationRepSplits: [{ childMigrationRepAmountAttoRep: 25n.toString(), childUniverseId: childUniverseId('0', '1'), outcomeIndex: '1', universeId: '0' }],
		openOracle,
		reports: [report(openOracle)],
		schemaVersion: 2,
		securityPoolForker: address(30),
		startBlock: '10',
		wallet: address(22),
		zoltar: address(31),
	}
}

async function storedReference(path: string) {
	const state = JSON.parse(await readFile(path, 'utf8')) as { protocolIndex: { kind: string; manifestDigest: `0x${string}`; schemaVersion: number } }
	return state.protocolIndex
}

async function generationPath(path: string) {
	const reference = await storedReference(path)
	return join(protocolIndexSidecarDirectory(path), reference.manifestDigest.slice(2))
}

async function firstChunk(path: string) {
	const generation = await generationPath(path)
	const name = (await readdir(generation)).find(candidate => candidate.endsWith('.json') && candidate !== 'manifest.json')
	if (name === undefined) throw new Error('Expected a protocol-index chunk')
	return join(generation, name)
}

async function saveIndex(path: string, index = protocolIndex()) {
	const state = initialDurableState(1, true, 'profile:index', index.wallet)
	state.protocolIndex = index
	await saveDurableState(path, state)
	return state
}

function largeProtocolIndex(count: number) {
	const index = protocolIndex()
	const auction = index.openOracle.toLowerCase()
	index.reports = []
	index.auctionBids = {
		[auction]: Array.from({ length: count }, (_, position) => ({ amountAttoEth: (position + 1).toString(), index: position.toString(), refunded: false, tick: position.toString() })),
	}
	index.escalationDeposits = Array.from({ length: count }, (_, position) => ({
		amountAttoRep: (position + 1).toString(),
		claimed: false,
		depositIndex: position.toString(),
		escalationGame: index.openOracle,
		outcome: 1,
		parentDepositIndex: position.toString(),
		pool: address(21),
		vault: address(22),
	}))
	index.migrationRepSplits = Array.from({ length: count }, (_, position) => {
		const outcomeIndex = position.toString()
		return { childMigrationRepAmountAttoRep: (position + 1).toString(), childUniverseId: childUniverseId('0', outcomeIndex), outcomeIndex, universeId: '0' }
	})
	index.childRepSplits = Array.from({ length: count }, (_, position) => ({ childPoolRepSplitAttoRep: (position + 1).toString(), outcomeIndex: position.toString(), pool: index.openOracle }))
	return index
}

describe('protocol-index sidecar generations', () => {
	test('round-trips more than ten thousand bids, deposits, migration routes, and child routes while the main journal stays bounded', async () => {
		const path = await statePath()
		const count = 10_257
		const expected = largeProtocolIndex(count)
		const state = await saveIndex(path, expected)

		const mainContents = await readFile(path, 'utf8')
		const reference = await storedReference(path)
		expect(Buffer.byteLength(mainContents, 'utf8')).toBeLessThan(16 * 1024)
		expect(reference).toMatchObject({ kind: 'protocol-index-sidecar', schemaVersion: 1 })
		expect(mainContents).not.toContain('migrationRepSplits')

		const restored = await loadDurableState(path, 1)
		expect(restored.protocolIndex?.auctionBids[expected.openOracle.toLowerCase()]).toHaveLength(count)
		expect(restored.protocolIndex?.escalationDeposits).toHaveLength(count)
		expect(restored.protocolIndex?.migrationRepSplits).toHaveLength(count)
		expect(restored.protocolIndex?.childRepSplits).toHaveLength(count)
		expect(restored.protocolIndex?.migrationRepSplits.at(-1)?.outcomeIndex).toBe((count - 1).toString())
		expect((await readdir(await generationPath(path))).filter(name => name.endsWith('.json')).length).toBeGreaterThan((count / MAXIMUM_PROTOCOL_INDEX_CHUNK_RECORDS) * 4)

		let chunkReadCount = 0
		const filesystem: StateFilesystem = {
			mkdir,
			open: async (filePath, flags, mode) => {
				if (typeof flags === 'number' && /(?:reports|auction-bids|escalation-deposits|migration-routes|child-routes)-\d+-[0-9a-f]{64}\.json$/.test(String(filePath))) chunkReadCount += 1
				return open(filePath, flags, mode)
			},
			readFile,
			readdir,
			rename,
			rm,
		}
		await saveDurableState(path, state, filesystem)
		expect(chunkReadCount).toBe(0)
	}, 300_000)

	test('rejects corrupt, missing, and symbolic-link chunks', async () => {
		const corruptPath = await statePath()
		await saveIndex(corruptPath)
		const corruptChunk = await firstChunk(corruptPath)
		await writeFile(corruptChunk, `${await readFile(corruptChunk, 'utf8')} `)
		await expect(loadDurableState(corruptPath, 1)).rejects.toThrow('digest does not match')

		const missingPath = await statePath()
		await saveIndex(missingPath)
		await rm(await firstChunk(missingPath))
		await expect(loadDurableState(missingPath, 1)).rejects.toThrow('missing or has extra chunks')

		const oversizedPath = await statePath()
		await saveIndex(oversizedPath)
		await truncate(await firstChunk(oversizedPath), MAXIMUM_PROTOCOL_INDEX_CHUNK_BYTES + 1)
		await expect(loadDurableState(oversizedPath, 1)).rejects.toThrow('byte safety limit')

		const linkedPath = await statePath()
		await saveIndex(linkedPath)
		const linkedChunk = await firstChunk(linkedPath)
		const realChunk = `${linkedPath}.chunk-original`
		await rename(linkedChunk, realChunk)
		await symlink(realChunk, linkedChunk)
		await expect(loadDurableState(linkedPath, 1)).rejects.toThrow('regular non-symbolic-link file')
	})

	test('rejects permissive sidecar files and symbolic-link generation directories', async () => {
		const permissivePath = await statePath()
		await saveIndex(permissivePath)
		const chunk = await firstChunk(permissivePath)
		await chmod(chunk, 0o644)
		await expect(loadDurableState(permissivePath, 1)).rejects.toThrow('owner-only mode 0600')

		const linkedPath = await statePath()
		await saveIndex(linkedPath)
		const generation = await generationPath(linkedPath)
		const movedGeneration = `${generation}.original`
		await rename(generation, movedGeneration)
		await symlink(movedGeneration, generation)
		await expect(loadDurableState(linkedPath, 1)).rejects.toThrow()
	})

	test('does not follow a symbolic-link protocol-index store', async () => {
		const path = await statePath()
		await saveIndex(path)
		const store = protocolIndexSidecarDirectory(path)
		const movedStore = `${store}.original`
		await rename(store, movedStore)
		await symlink(movedStore, store)
		await expect(loadDurableState(path, 1)).rejects.toThrow()
	})

	test('keeps the old complete reference when the main-state commit crashes after the new generation commit', async () => {
		const path = await statePath()
		await saveIndex(path, protocolIndex('50', '44'))
		const before = await readFile(path, 'utf8')
		let sidecarCommitted = false
		const filesystem: StateFilesystem = {
			mkdir,
			open,
			readFile,
			readdir,
			rename: async (oldPath, newPath) => {
				if (newPath === path) {
					const error = new Error('simulated main-state rename crash') as Error & { code: string }
					error.code = 'EIO'
					throw error
				}
				if (newPath.startsWith(protocolIndexSidecarDirectory(path))) sidecarCommitted = true
				await rename(oldPath, newPath)
			},
			rm,
		}
		const replacement = initialDurableState(1, true, 'profile:index', address(22))
		replacement.protocolIndex = protocolIndex('51', '66')
		await expect(saveDurableState(path, replacement, filesystem)).rejects.toThrow('simulated main-state rename crash')
		expect(sidecarCommitted).toBeTrue()
		expect(await readFile(path, 'utf8')).toBe(before)
		expect((await loadDurableState(path, 1)).protocolIndex?.cursor.blockNumber).toBe('50')
		expect((await readdir(protocolIndexSidecarDirectory(path))).filter(name => /^[0-9a-f]{64}$/.test(name))).toHaveLength(2)

		await saveDurableState(path, replacement)
		expect((await loadDurableState(path, 1)).protocolIndex?.cursor.blockNumber).toBe('51')
		expect((await readdir(protocolIndexSidecarDirectory(path))).filter(name => /^[0-9a-f]{64}$/.test(name))).toHaveLength(1)
	})

	test('ignores unreferenced partial generations and rejects a main reference to one', async () => {
		const path = await statePath()
		const state = await saveIndex(path)
		const store = protocolIndexSidecarDirectory(path)
		const partialDigest = '77'.repeat(32)
		const partial = join(store, partialDigest)
		await mkdir(partial, { mode: 0o700 })
		expect((await loadDurableState(path, 1)).protocolIndex?.cursor.blockNumber).toBe('50')

		const main = JSON.parse(await readFile(path, 'utf8')) as { protocolIndex: { manifestDigest: string } }
		main.protocolIndex.manifestDigest = `0x${partialDigest}`
		await writeFile(path, `${JSON.stringify(main)}\n`)
		await expect(loadDurableState(path, 1)).rejects.toThrow()

		await saveDurableState(path, state)
		await expect(stat(partial)).rejects.toMatchObject({ code: 'ENOENT' })
	})

	test('loads the current inline index schema and migrates it on the next save', async () => {
		const path = await statePath()
		const state = initialDurableState(1, true, 'profile:inline', address(22))
		state.protocolIndex = protocolIndex()
		await writeFile(path, `${JSON.stringify(serializedDurableState(state), undefined, 2)}\n`, { mode: 0o600 })
		const loaded = await loadDurableState(path, 1)
		expect(loaded.protocolIndex?.cursor.blockNumber).toBe('50')
		await saveDurableState(path, loaded)
		expect((await storedReference(path)).kind).toBe('protocol-index-sidecar')
	})

	test('binds a persisted index to its durable chain and signer identities', async () => {
		const chainPath = await statePath()
		await saveIndex(chainPath)
		const main = JSON.parse(await readFile(chainPath, 'utf8')) as { chainId: number }
		main.chainId = 2
		await writeFile(chainPath, `${JSON.stringify(main)}\n`)
		await expect(loadDurableState(chainPath, 2)).rejects.toThrow('Protocol index belongs to chain 1')

		const signerPath = await statePath()
		const state = initialDurableState(1, true, 'profile:index', address(99))
		state.protocolIndex = protocolIndex()
		await expect(saveDurableState(signerPath, state)).rejects.toThrow('Protocol index wallet does not match the durable signer scope')
	})

	test('rejects duplicate canonical records without imposing a total item-count ceiling', () => {
		const duplicateBid = protocolIndex()
		const key = duplicateBid.openOracle.toLowerCase()
		const bid = duplicateBid.auctionBids[key]?.[0]
		if (bid === undefined) throw new Error('Expected bid fixture')
		duplicateBid.auctionBids[key] = [bid, { ...bid }]
		expect(() => parseProtocolIndex(duplicateBid, 1)).toThrow('canonical unique route order')

		const many = largeProtocolIndex(10_001)
		expect(parseProtocolIndex(many, 1)?.migrationRepSplits).toHaveLength(10_001)
	})
})

import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION, IMMUTABLE_TOPOLOGY_SEGMENT_BYTES, immutableTopologySidecarDirectory, loadImmutableTopologyCache, saveImmutableTopologyCache, type CanonicalImmutableTopologyCache, type ImmutableTopologyIdentity } from '../../src/monitoring/topology-cache.ts'
import { address, hash } from '../operations/fixture.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

async function temporaryStatePath() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-topology-'))
	temporaryDirectories.push(directory)
	return join(directory, 'operator.json')
}

function identity(): ImmutableTopologyIdentity {
	return {
		chainId: 31_337,
		openOracle: address(6),
		questionData: address(3),
		securityPoolFactory: address(4),
		securityPoolForker: address(5),
		tradingFactory: address(8),
		tradingRouter: address(9),
		weth: address(7),
		zoltar: address(2),
	}
}

function cache(questionCount = 2): CanonicalImmutableTopologyCache {
	const pool = address(20)
	return {
		anchor: { blockHash: hash(50), blockNumber: '50' },
		pairsByPool: { [pool.toLowerCase()]: address(30) },
		poolDeployments: [
			{
				coordinator: address(21),
				parent: address(0),
				questionId: '1',
				securityPool: pool,
				shareToken: address(22),
				truthAuction: address(23),
				universeId: '0',
			},
		],
		questions: Array.from({ length: questionCount }, (_, index) => ({
			createdAt: index.toString(),
			endTime: (index + 2).toString(),
			id: index.toString(),
			kind: 'binary' as const,
			numTicks: '2',
			outcomeLabels: [`Yes-${index.toString().padStart(8, '0')}`, `No-${index.toString().padStart(8, '0')}`],
			startTime: (index + 1).toString(),
		})),
		schemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
		universeChildren: { '0': { childUniverseIds: ['1', '2'], outcomeIndexes: ['1', '2'] } },
		vaultsByPool: { [pool.toLowerCase()]: [address(40), address(41)] },
	}
}

describe('immutable topology sidecar', () => {
	test('invalidates a schema-one cache whose categorical labels may have been truncated', async () => {
		const statePath = await temporaryStatePath()
		const storePath = immutableTopologySidecarDirectory(statePath)
		await mkdir(storePath, { mode: 0o700 })
		const legacyCache = { ...cache(), schemaVersion: 1 }
		const firstQuestion = legacyCache.questions[0]
		if (firstQuestion === undefined) throw new Error('Legacy topology fixture has no question')
		firstQuestion.kind = 'categorical'
		firstQuestion.outcomeLabels = Array.from({ length: 256 }, (_, index) => `Possibly truncated outcome ${index.toString()}`)
		const payload = Buffer.from(`${JSON.stringify(legacyCache)}\n`, 'utf8')
		const digest = (value: string | Uint8Array) => `0x${createHash('sha256').update(value).digest('hex')}`
		const payloadDigest = digest(payload)
		const segmentDigest = payloadDigest
		const manifestPayload = {
			anchor: legacyCache.anchor,
			identity: identity(),
			manifestSchemaVersion: 1,
			payloadBytes: payload.byteLength.toString(),
			payloadDigest,
			payloadSchemaVersion: 1,
			segmentCount: '1',
			segmentsDigest: digest(`0:${segmentDigest}\n`),
			storeSchemaVersion: 1,
		}
		const manifestDigest = digest(JSON.stringify(manifestPayload))
		const generationPath = join(storePath, manifestDigest.slice(2))
		await mkdir(generationPath, { mode: 0o700 })
		await writeFile(join(generationPath, `segment-0-${segmentDigest.slice(2)}.bin`), payload, { mode: 0o600 })
		await writeFile(join(generationPath, 'manifest.json'), `${JSON.stringify({ ...manifestPayload, manifestDigest })}\n`, { mode: 0o600 })
		await writeFile(join(storePath, 'current.json'), `${JSON.stringify({ manifestDigest, schemaVersion: 1 })}\n`, { mode: 0o600 })

		await expect(loadImmutableTopologyCache(statePath, identity())).resolves.toBeUndefined()
	})

	test('round-trips more than ten thousand immutable records through checksummed fixed-size segments', async () => {
		const statePath = await temporaryStatePath()
		const expected = cache(10_500)
		await saveImmutableTopologyCache(statePath, identity(), expected)
		const restored = await loadImmutableTopologyCache(statePath, identity())
		expect(restored).toEqual(expected)

		const storePath = immutableTopologySidecarDirectory(statePath)
		const entries = await readdir(storePath, { withFileTypes: true })
		const generation = entries.find(entry => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
		if (generation === undefined) throw new Error('Immutable topology generation was not committed')
		const generationEntries = await readdir(join(storePath, generation.name))
		const segments = generationEntries.filter(name => name.startsWith('segment-')).sort((left, right) => Number(left.split('-')[1]) - Number(right.split('-')[1]))
		expect(segments.length).toBeGreaterThan(1)
		for (const segment of segments.slice(0, -1)) expect((await stat(join(storePath, generation.name, segment))).size).toBe(IMMUTABLE_TOPOLOGY_SEGMENT_BYTES)
		expect((await stat(storePath)).mode & 0o777).toBe(0o700)
		expect((await stat(join(storePath, 'current.json'))).mode & 0o777).toBe(0o600)
	})

	test('rejects a corrupted committed segment and a symbolic-link pointer', async () => {
		const statePath = await temporaryStatePath()
		await saveImmutableTopologyCache(statePath, identity(), cache(10_500))
		const storePath = immutableTopologySidecarDirectory(statePath)
		const generation = (await readdir(storePath, { withFileTypes: true })).find(entry => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
		if (generation === undefined) throw new Error('Immutable topology generation was not committed')
		const generationPath = join(storePath, generation.name)
		const segment = (await readdir(generationPath)).find(name => name.startsWith('segment-'))
		if (segment === undefined) throw new Error('Immutable topology generation has no segment')
		const segmentPath = join(generationPath, segment)
		const contents = await readFile(segmentPath)
		const first = contents[0]
		if (first === undefined) throw new Error('Immutable topology segment is empty')
		contents[0] = first ^ 1
		await writeFile(segmentPath, contents)
		await expect(loadImmutableTopologyCache(statePath, identity())).rejects.toThrow('digest')

		await saveImmutableTopologyCache(statePath, identity(), cache())
		const pointerPath = join(storePath, 'current.json')
		const realPointerPath = join(storePath, 'real-current.json')
		await rename(pointerPath, realPointerPath)
		await symlink(realPointerPath, pointerPath)
		await expect(loadImmutableTopologyCache(statePath, identity())).rejects.toThrow('symbolic link')
	})

	test('ignores an orphan generation and does not reuse a cache for another deployment identity', async () => {
		const statePath = await temporaryStatePath()
		const expected = cache()
		await saveImmutableTopologyCache(statePath, identity(), expected)
		const storePath = immutableTopologySidecarDirectory(statePath)
		await mkdir(join(storePath, '.tmp-999-deadbeef-dead-beef-dead-beefdeadbeef'), { mode: 0o700 })
		expect(await loadImmutableTopologyCache(statePath, identity())).toEqual(expected)
		expect(await loadImmutableTopologyCache(statePath, { ...identity(), tradingFactory: address(99) })).toBeUndefined()
	})

	test('prunes abandoned generation and pointer temporary files after the next commit', async () => {
		const statePath = await temporaryStatePath()
		await saveImmutableTopologyCache(statePath, identity(), cache())
		const storePath = immutableTopologySidecarDirectory(statePath)
		const temporaryGeneration = join(storePath, '.tmp-999-deadbeef-dead-beef-dead-beefdeadbeef')
		const temporaryPointer = join(storePath, '.current-999-deadbeef-dead-beef-dead-beefdeadbeef.json')
		await mkdir(temporaryGeneration, { mode: 0o700 })
		await writeFile(temporaryPointer, '{}\n', { mode: 0o600 })

		const next = { ...cache(), anchor: { blockHash: hash(51), blockNumber: '51' } }
		await saveImmutableTopologyCache(statePath, identity(), next)
		const entries = await readdir(storePath)
		expect(entries).not.toContain('.tmp-999-deadbeef-dead-beef-dead-beefdeadbeef')
		expect(entries).not.toContain('.current-999-deadbeef-dead-beef-dead-beefdeadbeef.json')
		expect(await loadImmutableTopologyCache(statePath, identity())).toEqual(next)
	})
})

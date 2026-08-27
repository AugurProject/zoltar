import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION, IMMUTABLE_TOPOLOGY_SEGMENT_BYTES, immutableTopologySidecarDirectory, loadImmutableTopologyCache, saveImmutableTopologyCache, type CanonicalImmutableTopologyCache, type ImmutableTopologyIdentity } from '../../src/monitoring/topology-cache.ts'
import { address, hash } from '../operations/fixture.ts'

const temporaryDirectories: string[] = []

function digest(value: string | Uint8Array) {
	return `0x${createHash('sha256').update(value).digest('hex')}` as const
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${label} must be an object`)
	return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function rewriteCurrentManifest(statePath: string, mutate: (manifest: Record<string, unknown>) => void) {
	const storePath = immutableTopologySidecarDirectory(statePath)
	const generation = (await readdir(storePath, { withFileTypes: true })).find(entry => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
	if (generation === undefined) throw new Error('Immutable topology generation was not committed')
	const generationPath = join(storePath, generation.name)
	const manifest = object(JSON.parse(await readFile(join(generationPath, 'manifest.json'), 'utf8')), 'Immutable topology manifest fixture')
	mutate(manifest)
	const payload = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'manifestDigest'))
	const manifestDigest = digest(JSON.stringify(payload))
	manifest['manifestDigest'] = manifestDigest
	await writeFile(join(generationPath, 'manifest.json'), `${JSON.stringify(manifest)}\n`, { mode: 0o600 })
	const rewrittenPath = join(storePath, manifestDigest.slice(2))
	await rename(generationPath, rewrittenPath)
	await writeFile(join(storePath, 'current.json'), `${JSON.stringify({ manifestDigest, schemaVersion: 1 })}\n`, { mode: 0o600 })
	return rewrittenPath
}

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
		discoveryCursors: {
			poolDeployments: { canonicalCount: '1', commitment: hash(61), nextIndex: '1', residentLimit: '100', retentionMode: 'resident' },
			questions: { canonicalCount: questionCount.toString(), commitment: hash(62), nextIndex: questionCount.toString(), residentLimit: questionCount.toString(), retentionMode: 'resident' },
			vaultsByPool: { [pool.toLowerCase()]: { canonicalCount: '2', commitment: hash(63), nextIndex: '2', residentLimit: '100', retentionMode: 'resident' } },
		},
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

	test('round-trips more than ten thousand immutable records through checksummed bounded chunks', async () => {
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
		const chunks = generationEntries.filter(name => name.endsWith('.json') && name !== 'manifest.json')
		expect(chunks.length).toBeGreaterThan(1)
		for (const chunk of chunks) expect((await stat(join(storePath, generation.name, chunk))).size).toBeLessThanOrEqual(IMMUTABLE_TOPOLOGY_SEGMENT_BYTES)
		expect((await stat(storePath)).mode & 0o777).toBe(0o700)
		expect((await stat(join(storePath, 'current.json'))).mode & 0o777).toBe(0o600)
	})

	test('streams authenticated segments without concatenating the complete payload', async () => {
		const statePath = await temporaryStatePath()
		const expected = cache(10_500)
		await saveImmutableTopologyCache(statePath, identity(), expected)
		const concatenate = Buffer.concat
		Buffer.concat = () => {
			throw new Error('Whole-payload concatenation is forbidden')
		}
		try {
			expect(await loadImmutableTopologyCache(statePath, identity())).toEqual(expected)
		} finally {
			Buffer.concat = concatenate
		}
	})

	test('round-trips a valid outcome label larger than the former character cap', async () => {
		const statePath = await temporaryStatePath()
		const expected = cache(1)
		const question = expected.questions[0]
		if (question === undefined) throw new Error('Immutable topology fixture has no question')
		question.kind = 'categorical'
		question.outcomeLabels = ['x'.repeat(20_000)]
		await saveImmutableTopologyCache(statePath, identity(), expected)
		expect(await loadImmutableTopologyCache(statePath, identity())).toEqual(expected)
	})

	test('rejects an oversized manifest before reading or decoding committed chunks', async () => {
		const statePath = await temporaryStatePath()
		await saveImmutableTopologyCache(statePath, identity(), cache(10_500))
		const storePath = immutableTopologySidecarDirectory(statePath)
		const generation = (await readdir(storePath, { withFileTypes: true })).find(entry => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
		if (generation === undefined) throw new Error('Immutable topology generation was not committed')
		const generationPath = join(storePath, generation.name)
		const questionChunk = (await readdir(generationPath)).find(name => name.startsWith('questions-'))
		if (questionChunk === undefined) throw new Error('Immutable topology generation has no question chunk')
		await writeFile(join(generationPath, questionChunk), '{not valid json', { mode: 0o600 })

		await expect(
			loadImmutableTopologyCache(statePath, identity(), {
				maxPools: 100,
				maxQuestions: 10,
				maxUniverses: 100,
				maxVaultsPerPool: 100,
			}),
		).rejects.toThrow('configured question resident limit')
	})

	test('rejects aggregate vault payloads against live limits before decoding their chunks', async () => {
		const statePath = await temporaryStatePath()
		const expected = cache()
		const pool = address(20).toLowerCase()
		expected.discoveryCursors.vaultsByPool[pool] = { canonicalCount: '10', commitment: hash(70), nextIndex: '10', residentLimit: '10', retentionMode: 'resident' }
		expected.vaultsByPool[pool] = Array.from({ length: 10 }, (_, index) => address(700 + index))
		await saveImmutableTopologyCache(statePath, identity(), expected)
		const storePath = immutableTopologySidecarDirectory(statePath)
		const generation = (await readdir(storePath, { withFileTypes: true })).find(entry => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
		if (generation === undefined) throw new Error('Immutable topology generation was not committed')
		const generationPath = join(storePath, generation.name)
		const vaultChunk = (await readdir(generationPath)).find(name => name.startsWith('vaults-'))
		if (vaultChunk === undefined) throw new Error('Immutable topology generation has no vault chunk')
		await writeFile(join(generationPath, vaultChunk), '{not valid json', { mode: 0o600 })

		await expect(loadImmutableTopologyCache(statePath, identity(), { maxPools: 1, maxQuestions: 2, maxUniverses: 3, maxVaultsPerPool: 1 })).rejects.toThrow('aggregate vault resident limit')
	})

	test('rejects an underreported collection before appending records beyond its manifest commitment', async () => {
		const statePath = await temporaryStatePath()
		await saveImmutableTopologyCache(statePath, identity(), cache(300))
		const rewrittenPath = await rewriteCurrentManifest(statePath, manifest => {
			const questions = object(object(manifest['collections'], 'Immutable topology collections fixture')['questions'], 'Immutable topology question commitment fixture')
			questions['recordCount'] = '2'
		})
		const questionChunks = (await readdir(rewrittenPath)).filter(name => name.startsWith('questions-')).sort()
		const poisonedChunk = questionChunks[1]
		if (poisonedChunk === undefined) throw new Error('Immutable topology fixture must span at least two question chunks')
		await writeFile(join(rewrittenPath, poisonedChunk), '{not valid json', { mode: 0o600 })

		await expect(loadImmutableTopologyCache(statePath, identity())).rejects.toThrow('questions collection record count exceeds its manifest commitment')
	})

	test('rejects underreported committed bytes before decoding a collection chunk', async () => {
		const statePath = await temporaryStatePath()
		await saveImmutableTopologyCache(statePath, identity(), cache())
		await rewriteCurrentManifest(statePath, manifest => {
			const questions = object(object(manifest['collections'], 'Immutable topology collections fixture')['questions'], 'Immutable topology question commitment fixture')
			questions['committedBytes'] = '1'
		})
		await expect(loadImmutableTopologyCache(statePath, identity())).rejects.toThrow('questions collection committed bytes exceed its manifest commitment')
	})

	test('rejects underreported nested resident items before retaining a collection record', async () => {
		const statePath = await temporaryStatePath()
		await saveImmutableTopologyCache(statePath, identity(), cache(1))
		await rewriteCurrentManifest(statePath, manifest => {
			const questions = object(object(manifest['collections'], 'Immutable topology collections fixture')['questions'], 'Immutable topology question commitment fixture')
			questions['itemCount'] = '1'
		})
		await expect(loadImmutableTopologyCache(statePath, identity())).rejects.toThrow('questions collection resident-item count exceeds its manifest commitment')
	})

	test('persists exact overflow totals across restarts without retaining historical vault records', async () => {
		const statePath = await temporaryStatePath()
		const pool = address(20).toLowerCase()
		const limits = { maxPools: 3, maxQuestions: 3, maxUniverses: 3, maxVaultsPerPool: 3 }
		let expected = cache()
		expected.vaultsByPool = {}
		for (const nextIndex of [3, 6, 9, 11]) {
			expected = {
				...expected,
				anchor: { blockHash: hash(100 + nextIndex), blockNumber: (100 + nextIndex).toString() },
				discoveryCursors: {
					...expected.discoveryCursors,
					vaultsByPool: {
						[pool]: { canonicalCount: '11', commitment: hash(200 + nextIndex), nextIndex: nextIndex.toString(), residentLimit: '3', retentionMode: 'overflow' },
					},
				},
			}
			await saveImmutableTopologyCache(statePath, identity(), expected, limits)
			const restored = await loadImmutableTopologyCache(statePath, identity(), limits)
			expect(restored?.discoveryCursors.vaultsByPool[pool]).toMatchObject({ canonicalCount: '11', nextIndex: nextIndex.toString(), retentionMode: 'overflow' })
			expect(restored?.vaultsByPool).toEqual({})
			if (restored === undefined) throw new Error('Immutable topology overflow cursor was not restored')
			expected = restored
		}
		const storePath = immutableTopologySidecarDirectory(statePath)
		const generation = (await readdir(storePath, { withFileTypes: true })).find(entry => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
		if (generation === undefined) throw new Error('Immutable topology generation was not committed')
		expect((await readdir(join(storePath, generation.name))).filter(name => name.startsWith('vaults-'))).toEqual([])
	})

	test('rejects a corrupted committed segment and a symbolic-link pointer', async () => {
		const statePath = await temporaryStatePath()
		await saveImmutableTopologyCache(statePath, identity(), cache(10_500))
		const storePath = immutableTopologySidecarDirectory(statePath)
		const generation = (await readdir(storePath, { withFileTypes: true })).find(entry => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
		if (generation === undefined) throw new Error('Immutable topology generation was not committed')
		const generationPath = join(storePath, generation.name)
		const chunk = (await readdir(generationPath)).find(name => name.endsWith('.json') && name !== 'manifest.json')
		if (chunk === undefined) throw new Error('Immutable topology generation has no chunk')
		const chunkPath = join(generationPath, chunk)
		const contents = await readFile(chunkPath)
		const first = contents[0]
		if (first === undefined) throw new Error('Immutable topology segment is empty')
		contents[0] = first ^ 1
		await writeFile(chunkPath, contents)
		await expect(loadImmutableTopologyCache(statePath, identity())).rejects.toThrow('digest')

		await saveImmutableTopologyCache(statePath, identity(), cache())
		const pointerPath = join(storePath, 'current.json')
		const realPointerPath = join(storePath, 'real-current.json')
		await rename(pointerPath, realPointerPath)
		await symlink(realPointerPath, pointerPath)
		await expect(loadImmutableTopologyCache(statePath, identity())).rejects.toThrow('symbolic link')
	})

	test('stops streaming a generation after its manifest-declared entry bound', async () => {
		const statePath = await temporaryStatePath()
		await saveImmutableTopologyCache(statePath, identity(), cache())
		const storePath = immutableTopologySidecarDirectory(statePath)
		const generation = (await readdir(storePath, { withFileTypes: true })).find(entry => entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name))
		if (generation === undefined) throw new Error('Immutable topology generation was not committed')
		const generationPath = join(storePath, generation.name)
		for (let index = 0; index < 20; index += 1) {
			await writeFile(join(generationPath, `questions-${(10_000 + index).toString()}-${hash(10_000 + index).slice(2)}.json`), '{}\n', { mode: 0o600 })
		}
		await expect(loadImmutableTopologyCache(statePath, identity())).rejects.toThrow('manifest-declared')
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

	test('reclaims repeated recognized orphan generations in bounded pre-write passes while retaining the current target', async () => {
		const statePath = await temporaryStatePath()
		const current = cache()
		await saveImmutableTopologyCache(statePath, identity(), current)
		const storePath = immutableTopologySidecarDirectory(statePath)
		for (let index = 0; index < 300; index += 1) await mkdir(join(storePath, `.tmp-999-${index.toString(16).padStart(8, '0')}`), { mode: 0o700 })
		const next = { ...cache(), anchor: { blockHash: hash(52), blockNumber: '52' } }

		await expect(saveImmutableTopologyCache(statePath, identity(), next)).rejects.toThrow('per-cycle safety limit')
		expect(await loadImmutableTopologyCache(statePath, identity())).toEqual(current)
		await saveImmutableTopologyCache(statePath, identity(), next)
		expect(await loadImmutableTopologyCache(statePath, identity())).toEqual(next)
		expect((await readdir(storePath)).filter(name => name.startsWith('.tmp-'))).toEqual([])
	})
})

import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentRevision, readFileIfPresent, writeRevisionedFile } from '../../src/config/durable-file.ts'
import { assertProfileCandidates, chainSpecificPath, networkProfilePath, storedNetworkProfileCandidates, switchNetworkProfile, type ProfileCandidate } from '../../src/config/profiles.ts'
import { isRecord } from '../../src/infrastructure/json-validation.ts'
import type { NetworkName } from '../../src/monitoring/connectivity.ts'

test('network paths preserve directories and extensions and replace existing network suffixes', () => {
	for (const { path, expected } of [
		{ path: '/state/history.json', expected: '/state/history.sepolia.json' },
		{ path: '/state/history', expected: '/state/history.sepolia' },
		{ path: '/state/history.mainnet.json', expected: '/state/history.sepolia.json' },
		{ path: '/state/history.sepolia.json', expected: '/state/history.sepolia.json' },
		{ path: '/state.mainnet/history.json', expected: '/state.mainnet/history.sepolia.json' },
	])
		expect(chainSpecificPath(path, 'sepolia')).toBe(expected)
	expect(chainSpecificPath('/state/history.sepolia.json', 'mainnet')).toBe('/state/history.mainnet.json')
	expect(networkProfilePath('/state/operator.json', 'mainnet')).toBe('/state/operator.json.mainnet.profile')
})

// A minimal bot configuration: one tunable value plus the durable files the profile owns.
type Settings = {
	journals: string[]
	network: NetworkName
	paused: boolean
	runtime: { once: boolean; ui: boolean; uiHost: string; uiPort: number }
	tunable: number
}

function isSettings(value: unknown): value is Settings {
	if (!isRecord(value) || !isRecord(value['runtime'])) return false
	const { journals, network, paused, runtime, tunable } = value
	return (
		Array.isArray(journals) &&
		journals.every(journal => typeof journal === 'string') &&
		(network === 'mainnet' || network === 'sepolia') &&
		typeof paused === 'boolean' &&
		typeof tunable === 'number' &&
		typeof runtime['once'] === 'boolean' &&
		typeof runtime['ui'] === 'boolean' &&
		typeof runtime['uiHost'] === 'string' &&
		typeof runtime['uiPort'] === 'number'
	)
}

function parseStored(contents: string) {
	const value: unknown = JSON.parse(contents)
	if (!isSettings(value)) throw new Error('Stored test settings are malformed')
	return value
}

const errors = {
	crossChainPathReuse: 'Mainnet and Sepolia profiles must use distinct durable paths',
	duplicatePathsWithinProfile: (candidate: ProfileCandidate<Settings>) => `The ${candidate.expected} profile repeats a durable path`,
	reservedPathReuse: 'Durable paths must not reuse configuration or profile files',
}

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-profiles-'))
	temporaryDirectories.push(directory)
	const path = join(directory, 'operator.json')
	const conflict = () => new Error('Configuration changed on disk')
	const save = (target: string, settings: Settings, expectedRevision?: string) => writeRevisionedFile(target, `${JSON.stringify(settings)}\n`, { conflict, expectedRevision })
	const load = async (target: string): Promise<Settings | undefined> => {
		const contents = await readFileIfPresent(target)
		return contents === undefined ? undefined : parseStored(contents)
	}
	const loadProfile = (network: NetworkName) => load(networkProfilePath(path, network))
	const assertCandidates = (candidates: readonly ProfileCandidate<Settings>[]) =>
		assertProfileCandidates({
			assertIdentity: candidate => {
				if (candidate.settings.network !== candidate.expected) throw new Error(`The ${candidate.expected} profile contains ${candidate.settings.network} settings`)
			},
			candidates,
			durablePaths: candidate => candidate.settings.journals,
			errors,
			reservedPaths: [path, networkProfilePath(path, 'mainnet'), networkProfilePath(path, 'sepolia')],
		})
	const settings = (network: NetworkName, journals: readonly string[], runtime: Partial<Settings['runtime']> = {}): Settings => ({
		journals: [...journals],
		network,
		paused: false,
		runtime: { once: false, ui: true, uiHost: '127.0.0.1', uiPort: 4183, ...runtime },
		tunable: network === 'mainnet' ? 777 : 333,
	})
	const isolation = async () => {
		const active = await load(path)
		if (active === undefined) throw new Error('Expected active settings')
		const { candidates } = await storedNetworkProfileCandidates(active, value => value.network, loadProfile)
		await assertCandidates(candidates)
	}
	const switchTo = async (network: NetworkName) => {
		const contents = await readFile(path, 'utf8')
		return await switchNetworkProfile<Settings>({
			assertCandidates,
			createProfile: async target => ({ ...settings(target, [join(directory, `${target}-created.jsonl`)]), paused: true, tunable: 0 }),
			current: { revision: contentRevision(contents), settings: parseStored(contents) },
			loadProfile,
			network,
			networkOf: value => value.network,
			saveActive: (value, expectedRevision) => save(path, value, expectedRevision),
			saveProfile: (profileNetwork, value) => save(networkProfilePath(path, profileNetwork), value),
		})
	}
	const snapshot = (files: readonly string[]) => Promise.all(files.map(file => readFile(file, 'utf8')))
	return { directory, isolation, path, save, settings, snapshot, switchTo }
}

test('switching stores the active profile paused and restores a stored profile unchanged', async () => {
	const { directory, path, save, settings, switchTo } = await fixture()
	const mainnet = settings('mainnet', [join(directory, 'mainnet.jsonl')])
	await save(path, mainnet)
	const created = await switchTo('sepolia')
	expect(created.settings).toMatchObject({ network: 'sepolia', paused: true, tunable: 0 })
	expect(created.revision).toBe(contentRevision(await readFile(path, 'utf8')))
	await save(path, { ...created.settings, tunable: 333 }, created.revision)
	const restored = await switchTo('mainnet')
	expect(restored.settings).toEqual({ ...mainnet, paused: true })
	expect(parseStored(await readFile(networkProfilePath(path, 'sepolia'), 'utf8'))).toMatchObject({ paused: true, tunable: 333 })
	const unchanged = await switchTo('mainnet')
	expect(unchanged.settings).toEqual(restored.settings)
})

test('rejects a dormant profile that reuses the active chain durable path', async () => {
	const { directory, path, save, settings, snapshot, switchTo } = await fixture()
	const shared = join(directory, 'shared.jsonl')
	await save(path, settings('mainnet', [shared]))
	await save(networkProfilePath(path, 'sepolia'), settings('sepolia', [shared]))
	const before = await snapshot([path, networkProfilePath(path, 'sepolia')])
	await expect(switchTo('sepolia')).rejects.toThrow(errors.crossChainPathReuse)
	expect(await snapshot([path, networkProfilePath(path, 'sepolia')])).toEqual(before)
})

test('rejects cross-chain durable paths reached through symlinked directory aliases', async () => {
	const { directory, path, save, settings, switchTo } = await fixture()
	const durable = join(directory, 'durable')
	const alias = join(directory, 'durable-alias')
	await mkdir(durable)
	await symlink(durable, alias, 'dir')
	await save(path, settings('mainnet', [join(durable, 'shared.jsonl')]))
	await save(networkProfilePath(path, 'sepolia'), settings('sepolia', [join(alias, 'shared.jsonl')]))
	await expect(switchTo('sepolia')).rejects.toThrow(errors.crossChainPathReuse)
	expect(parseStored(await readFile(path, 'utf8'))).toMatchObject({ network: 'mainnet' })
})

test('rejects cross-chain durable paths reached through distinct dangling symlinks to one file before writing', async () => {
	const { directory, path, save, settings, snapshot, switchTo } = await fixture()
	const target = join(directory, 'missing-shared.jsonl')
	await symlink(target, join(directory, 'mainnet-alias.jsonl'))
	await symlink(target, join(directory, 'sepolia-alias.jsonl'))
	await save(path, settings('mainnet', [join(directory, 'mainnet-alias.jsonl')]))
	await save(networkProfilePath(path, 'sepolia'), settings('sepolia', [join(directory, 'sepolia-alias.jsonl')]))
	const before = await snapshot([path, networkProfilePath(path, 'sepolia')])
	await expect(switchTo('sepolia')).rejects.toThrow(errors.crossChainPathReuse)
	expect(await snapshot([path, networkProfilePath(path, 'sepolia')])).toEqual(before)
})

test('rejects durable paths that reuse the configuration or profile files before writing', async () => {
	for (const reserved of ['active', 'mainnet', 'sepolia'] as const) {
		const { directory, path, save, settings, snapshot, switchTo } = await fixture()
		const reservedPath = reserved === 'active' ? path : networkProfilePath(path, reserved)
		await save(path, settings('mainnet', [join(directory, 'mainnet.jsonl')]))
		await save(networkProfilePath(path, 'sepolia'), settings('sepolia', [join(directory, 'sepolia.jsonl'), reservedPath]))
		const before = await snapshot([path, networkProfilePath(path, 'sepolia')])
		await expect(switchTo('sepolia')).rejects.toThrow(errors.reservedPathReuse)
		expect(await snapshot([path, networkProfilePath(path, 'sepolia')])).toEqual(before)
	}
})

test('does not overwrite a profile file the active chain reuses as a durable path', async () => {
	const { directory, path, save, settings, snapshot, switchTo } = await fixture()
	const mainnetProfile = networkProfilePath(path, 'mainnet')
	await save(path, settings('mainnet', [mainnetProfile]))
	await save(mainnetProfile, settings('mainnet', [join(directory, 'mainnet.jsonl')]))
	await save(networkProfilePath(path, 'sepolia'), settings('sepolia', [join(directory, 'sepolia.jsonl')]))
	const files = [path, mainnetProfile, networkProfilePath(path, 'sepolia')]
	const before = await snapshot(files)
	await expect(switchTo('sepolia')).rejects.toThrow(errors.reservedPathReuse)
	expect(await snapshot(files)).toEqual(before)
})

test('rejects a profile that repeats one durable path', async () => {
	const { directory, path, save, settings, switchTo } = await fixture()
	const journal = join(directory, 'mainnet.jsonl')
	await save(path, settings('mainnet', [journal, journal]))
	await expect(switchTo('sepolia')).rejects.toThrow('The mainnet profile repeats a durable path')
})

test('rejects a sibling profile whose embedded chain identity does not match its filename', async () => {
	const { directory, isolation, path, save, settings, snapshot, switchTo } = await fixture()
	const mainnet = settings('mainnet', [join(directory, 'mainnet.jsonl')])
	await save(path, mainnet)
	await save(networkProfilePath(path, 'sepolia'), mainnet)
	const before = await snapshot([path, networkProfilePath(path, 'sepolia')])
	await expect(isolation()).rejects.toThrow('The sepolia profile contains mainnet settings')
	await expect(switchTo('sepolia')).rejects.toThrow('The sepolia profile contains mainnet settings')
	expect(await snapshot([path, networkProfilePath(path, 'sepolia')])).toEqual(before)
})

test('rejects an existing profile with a different process mode or dashboard binding before writing', async () => {
	for (const runtime of [{ once: true }, { ui: false }, { uiHost: '0.0.0.0' }, { uiPort: 4999 }]) {
		const { directory, path, save, settings, snapshot, switchTo } = await fixture()
		await save(path, settings('mainnet', [join(directory, 'mainnet.jsonl')]))
		await save(networkProfilePath(path, 'sepolia'), settings('sepolia', [join(directory, 'sepolia.jsonl')], runtime))
		const before = await snapshot([path, networkProfilePath(path, 'sepolia')])
		await expect(switchTo('sepolia')).rejects.toThrow('Chain profiles must use the same once mode and dashboard binding to switch in place')
		expect(await snapshot([path, networkProfilePath(path, 'sepolia')])).toEqual(before)
	}
})

test('the switch writes the active file only at the revision it loaded', async () => {
	const { directory, path, save, settings } = await fixture()
	await save(path, settings('mainnet', [join(directory, 'mainnet.jsonl')]))
	const loaded = await readFile(path, 'utf8')
	await save(path, { ...settings('mainnet', [join(directory, 'mainnet.jsonl')]), tunable: 1 })
	const result = switchNetworkProfile<Settings>({
		assertCandidates: async () => undefined,
		createProfile: async () => ({ ...settings('sepolia', [join(directory, 'sepolia.jsonl')]), paused: true }),
		current: { revision: contentRevision(loaded), settings: parseStored(loaded) },
		loadProfile: async () => undefined,
		network: 'sepolia',
		networkOf: value => value.network,
		saveActive: (value, expectedRevision) => save(path, value, expectedRevision),
		saveProfile: (network, value) => save(networkProfilePath(path, network), value),
	})
	await expect(result).rejects.toThrow('Configuration changed on disk')
	expect(parseStored(await readFile(path, 'utf8'))).toMatchObject({ network: 'mainnet', tunable: 1 })
})

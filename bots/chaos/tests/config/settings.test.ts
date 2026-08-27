import { chmod, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { CONFIGURATION_REVISION_CONFLICT, PRESERVE_PRIVATE_KEY, assertSettingsProfileIsolation, loadSettings, parseSettings, saveSettings, serializedSettings, settingsProfilePath, settingsProfilePathForNetwork, switchSettingsNetworkProfile, type SettingsFilesystem } from '../../src/config/settings.ts'
import { publicChaosConfiguration } from '../../src/dashboard/dashboard-server.ts'
import { carryProofDeploymentProfileId } from '../../src/monitoring/carry-proof-scan.ts'
import { chaosChain } from '../../src/runtime/canonical-scan.ts'

const directories: string[] = []
const configDirectory = resolve(import.meta.dir, '../../config')
const examplePath = resolve(configDirectory, 'operator.example.json')
const configuredPlaceholderPath = resolve(configDirectory, 'operator.configured-placeholder.json')
const customChainPlaceholderPath = resolve(configDirectory, 'operator.custom-chain-placeholder.json')

afterEach(async () => {
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function temporaryDirectory() {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-settings-'))
	directories.push(directory)
	return directory
}

async function storedExample() {
	const value: unknown = JSON.parse(await readFile(examplePath, 'utf8'))
	return record(value)
}

function record(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected an object fixture')
	return Object.fromEntries(Object.entries(value))
}

async function configuredExample(): Promise<Record<string, unknown>> {
	const value = await storedExample()
	return {
		...value,
		connectivity: {
			publicRpcUrls: ['https://public.example'],
			quorumRpcUrls: [],
			readRpcUrl: 'https://read.example',
			rpcQuorum: 1,
		},
		networkConfigured: true,
		paused: false,
	}
}

describe('chaos-bot settings', () => {
	test('parses every committed configuration example through the production schema', async () => {
		const paths = (await readdir(configDirectory)).filter(name => name.startsWith('operator.') && name.endsWith('.json')).map(name => resolve(configDirectory, name))
		expect(paths).toEqual(expect.arrayContaining([examplePath, configuredPlaceholderPath, customChainPlaceholderPath]))
		for (const path of paths) {
			const settings = parseSettings(JSON.parse(await readFile(path, 'utf8')))
			expect(settings.paused).toBeTrue()
			expect(settings.runtime.execute).toBeFalse()
			expect(settings.privateKey).toBeUndefined()
		}
		const configured = parseSettings(JSON.parse(await readFile(configuredPlaceholderPath, 'utf8')))
		expect(configured.networkConfigured).toBeTrue()
		expect(configured.connectivity).toMatchObject({ rpcQuorum: 2 })
		expect(configured.connectivity?.quorumRpcUrls).toHaveLength(2)
		const configuredRpcUrls = configured.connectivity === undefined ? [] : [configured.connectivity.readRpcUrl, ...configured.connectivity.quorumRpcUrls, ...configured.connectivity.publicRpcUrls]
		expect(configuredRpcUrls.every(url => new URL(url).hostname.endsWith('.invalid'))).toBeTrue()
		expect(Object.values(configured.deployment).every(address => typeof address === 'string' && address.startsWith('0x11111111111111111111111111111111111111'))).toBeTrue()
		const privateSettings = parseSettings({
			...serializedSettings(configured),
			submission: {
				minimumBundleRelaySuccesses: 2,
				mode: 'private',
				relayUrls: ['https://first-private-relay.example.invalid', 'https://second-private-relay.example.invalid'],
			},
		})
		expect(privateSettings.submission).toMatchObject({ minimumBundleRelaySuccesses: 2, mode: 'private' })
	})

	test('supports an explicit custom EVM chain and canonical round-trip', async () => {
		const source: unknown = JSON.parse(await readFile(customChainPlaceholderPath, 'utf8'))
		const settings = parseSettings(source)
		expect(settings.network).toEqual({
			chainId: 4_242_424_242,
			explorerUrl: 'https://explorer.custom-chain.example.invalid',
			kind: 'custom',
			name: 'Zoltar Custom Chain Placeholder',
		})
		const serialized = serializedSettings(settings)
		const roundTripped = parseSettings(serialized)
		expect(roundTripped).toEqual(settings)
		expect(serializedSettings(roundTripped)).toEqual(serialized)

		const chain = chaosChain(settings)
		expect(chain.id).toBe(4_242_424_242)
		expect(chain.name).toBe('Zoltar Custom Chain Placeholder')
		expect(chain.rpcUrls.default.http).toEqual(['https://read-primary.custom-chain.example.invalid/'])

		const privateKey = `0x${'33'.repeat(32)}` as const
		const withSigner = parseSettings({ ...serialized, privateKey })
		const publicConfiguration = serializedSettings(withSigner, true)
		expect(publicConfiguration.privateKey).toBe(PRESERVE_PRIVATE_KEY)
		expect(publicConfiguration.network).toEqual(serialized.network)
		expect(JSON.stringify(publicConfiguration)).not.toContain(privateKey)
		const dashboardConfiguration = publicChaosConfiguration({ hasSigner: true, settings: publicConfiguration })
		expect(dashboardConfiguration).toMatchObject({ chainId: 4_242_424_242, hasSigner: true, network: 'Zoltar Custom Chain Placeholder' })
		expect(JSON.stringify(dashboardConfiguration)).not.toContain('read-primary.custom-chain')
		expect(JSON.stringify(dashboardConfiguration)).not.toContain(settings.deployment.zoltar)

		const profilePath = settingsProfilePathForNetwork('/tmp/operator.json', settings.network)
		expect(profilePath).toBe('/tmp/operator.json.custom-chain-4242424242.profile')
		expect(profilePath).not.toContain(settings.network.name)
		expect(carryProofDeploymentProfileId(roundTripped)).toBe(carryProofDeploymentProfileId(settings))
		const differentChain = parseSettings({
			...serialized,
			network: { ...serialized.network, chainId: 4_242_424_243 },
		})
		expect(carryProofDeploymentProfileId(differentChain)).not.toBe(carryProofDeploymentProfileId(settings))
		expect(settingsProfilePathForNetwork('/tmp/operator.json', differentChain.network)).toBe('/tmp/operator.json.custom-chain-4242424243.profile')

		const directory = await temporaryDirectory()
		const path = join(directory, 'custom-operator.json')
		const firstRevision = await saveSettings(path, settings)
		const loaded = await loadSettings(path)
		const secondRevision = await saveSettings(path, loaded.settings, loaded.revision)
		expect(secondRevision).toBe(firstRevision)
	})

	test('rejects ambiguous or unsafe custom chain identities', async () => {
		const source = record(JSON.parse(await readFile(customChainPlaceholderPath, 'utf8')))
		const network = record(source['network'])
		for (const chainId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 1, 11_155_111]) {
			expect(() => parseSettings({ ...source, network: { ...network, chainId } })).toThrow('network.chainId')
		}
		for (const name of ['', ' ', ' leading-space', 'trailing-space ', 'x'.repeat(65), 'line\nbreak', 'mainnet', 'SEPOLIA']) {
			expect(() => parseSettings({ ...source, network: { ...network, name } })).toThrow('network.name')
		}
		expect(() => parseSettings({ ...source, network: { ...network, kind: 'private' } })).toThrow('network.kind must be custom')
		const implicitCustomNetwork = Object.fromEntries(Object.entries(network).filter(([key]) => key !== 'kind'))
		expect(() => parseSettings({ ...source, network: implicitCustomNetwork })).toThrow('network.kind must explicitly be custom')

		const pathLikeLabel = parseSettings({ ...source, network: { ...network, name: '../Zoltar QA / Chain' } })
		expect(settingsProfilePathForNetwork('/tmp/operator.json', pathLikeLabel.network)).toBe('/tmp/operator.json.custom-chain-4242424242.profile')
	})

	test('stores a custom profile under its chain ID rather than its display label', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'operator.json')
		const source = record(JSON.parse(await readFile(customChainPlaceholderPath, 'utf8')))
		const custom = parseSettings({
			...source,
			network: { ...record(source['network']), name: '../Zoltar QA / Chain' },
			runtime: { ...record(source['runtime']), stateFile: join(directory, 'custom-state.json') },
		})
		await saveSettings(path, custom)
		await switchSettingsNetworkProfile(path, 'sepolia', examplePath)
		const customProfilePath = join(directory, 'operator.json.custom-chain-4242424242.profile')
		const storedCustom = await loadSettings(customProfilePath)
		expect(storedCustom.settings.network).toEqual(custom.network)
		expect(await readdir(directory)).toContain('operator.json.custom-chain-4242424242.profile')
	})

	test('parses the documented chain forms with distinct durable state paths', async () => {
		const configuredSource = record(JSON.parse(await readFile(configuredPlaceholderPath, 'utf8')))
		const configuredRuntime = record(configuredSource['runtime'])
		const sepolia = parseSettings({
			...configuredSource,
			runtime: { ...configuredRuntime, stateFile: '.state/chaos.sepolia.json' },
		})
		expect(sepolia.network).toEqual({ chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' })
		const mainnet = parseSettings({
			...serializedSettings(sepolia),
			network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' },
			runtime: { ...serializedSettings(sepolia).runtime, stateFile: '.state/chaos.mainnet.json' },
		})
		expect(mainnet.network).toEqual({ chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' })
		expect(mainnet.runtime.stateFile).not.toBe(sepolia.runtime.stateFile)
		const customSource = record(JSON.parse(await readFile(customChainPlaceholderPath, 'utf8')))
		const custom = parseSettings({
			...customSource,
			runtime: { ...record(customSource['runtime']), stateFile: '.state/chaos.custom-4242424242.json' },
		})
		expect(new Set([sepolia.runtime.stateFile, mainnet.runtime.stateFile, custom.runtime.stateFile]).size).toBe(3)
		expect(() =>
			parseSettings({
				...serializedSettings(sepolia),
				network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'sepolia' },
			}),
		).toThrow('must identify the same supported chain')
	})

	test('keeps durable state distinct between custom and preset chain IDs', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'operator.json')
		const sharedStateFile = join(directory, 'shared-state.json')
		const customSource = record(JSON.parse(await readFile(customChainPlaceholderPath, 'utf8')))
		const custom = parseSettings({ ...customSource, runtime: { ...record(customSource['runtime']), stateFile: sharedStateFile } })
		const mainnet = parseSettings({
			...serializedSettings(custom),
			network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' },
			runtime: { ...serializedSettings(custom).runtime, stateFile: sharedStateFile },
		})
		await saveSettings(settingsProfilePath(path, 'mainnet'), mainnet)
		await expect(assertSettingsProfileIsolation(path, custom)).rejects.toThrow('different chain IDs must use distinct durable state paths')
	})

	test('ships in paused dry-run mode with every ecosystem enabled', async () => {
		const settings = parseSettings(await storedExample())
		expect(settings.paused).toBe(true)
		expect(settings.runtime.execute).toBe(false)
		expect(settings.runtime.protocolLogBlockSpan).toBe(2_000)
		expect(settings.runtime.protocolStartBlock).toBe(0n)
		expect(settings.discovery).toEqual({
			maxPools: 100,
			maxQuestions: 100,
			maxStagedOperationsPerPool: 100,
			maxUniverses: 100,
			maxVaultsPerPool: 100,
		})
		expect(settings.privateKey).toBeUndefined()
		expect(settings.strategy.allowHighRiskOperations).toBe(false)
		expect(settings.strategy.enabledEcosystems).toEqual(['zoltar', 'statoblast', 'open-oracle', 'trading'])
		expect(settings.scheduler).toEqual({ maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 })
	})

	test('bounds every canonical discovery collection', async () => {
		const example = await storedExample()
		const discovery = record(example['discovery'])
		for (const field of Object.keys(discovery)) {
			expect(() => parseSettings({ ...example, discovery: { ...discovery, [field]: 0 } })).toThrow(`discovery.${field}`)
			expect(() => parseSettings({ ...example, discovery: { ...discovery, [field]: 10_001 } })).toThrow(`discovery.${field}`)
		}
	})

	test('bounds aggregate pool fan-out across universe, vault, and staged-operation registries', async () => {
		const example = await storedExample()
		const discovery = record(example['discovery'])
		expect(() => parseSettings({ ...example, discovery: { ...discovery, maxPools: 101, maxStagedOperationsPerPool: 1, maxUniverses: 100, maxVaultsPerPool: 1 } })).toThrow('maxPools × discovery.maxUniverses')
		expect(() => parseSettings({ ...example, discovery: { ...discovery, maxPools: 101, maxStagedOperationsPerPool: 1, maxUniverses: 1, maxVaultsPerPool: 100 } })).toThrow('maxPools × discovery.maxVaultsPerPool')
		expect(() => parseSettings({ ...example, discovery: { ...discovery, maxPools: 101, maxStagedOperationsPerPool: 100, maxUniverses: 1, maxVaultsPerPool: 1 } })).toThrow('maxPools × discovery.maxStagedOperationsPerPool')
	})

	test('bounds the cursor-based protocol log update span', async () => {
		const example = await storedExample()
		expect(() => parseSettings({ ...example, runtime: { ...record(example['runtime']), protocolLogBlockSpan: 0 } })).toThrow('protocolLogBlockSpan')
		expect(() => parseSettings({ ...example, runtime: { ...record(example['runtime']), protocolLogBlockSpan: 50_001 } })).toThrow('protocolLogBlockSpan')
	})

	test('requires an exact immutable protocol index start block string', async () => {
		const example = await storedExample()
		expect(() => parseSettings({ ...example, runtime: { ...record(example['runtime']), protocolStartBlock: 0 } })).toThrow('protocolStartBlock must be a non-negative integer string')
		expect(() => parseSettings({ ...example, runtime: { ...record(example['runtime']), protocolStartBlock: '01' } })).toThrow('protocolStartBlock must be a non-negative integer string')
		const settings = parseSettings({ ...example, runtime: { ...record(example['runtime']), protocolStartBlock: '12345678' } })
		expect(settings.runtime.protocolStartBlock).toBe(12_345_678n)
		expect(serializedSettings(settings).runtime.protocolStartBlock).toBe('12345678')
	})

	test('redacts a saved signer and can preserve it through a dashboard edit', async () => {
		const privateKey = `0x${'11'.repeat(32)}` as const
		const settings = parseSettings({ ...(await storedExample()), privateKey })
		const redacted = serializedSettings(settings, true)
		expect(redacted.privateKey).toBe(PRESERVE_PRIVATE_KEY)
		expect(JSON.stringify(redacted)).not.toContain(privateKey)
		expect(parseSettings(redacted, privateKey).privateKey).toBe(privateKey)
		expect(() => parseSettings(redacted)).toThrow('only preserve an existing saved signer')
	})

	test('requires configured, funded deployment inputs before live execution', async () => {
		const configured = await configuredExample()
		expect(() => parseSettings({ ...configured, runtime: { ...record(configured['runtime']), execute: true } })).toThrow('Live execution requires privateKey')
		const privateKey = `0x${'22'.repeat(32)}` as const
		expect(() => parseSettings({ ...configured, privateKey, runtime: { ...record(configured['runtime']), execute: true } })).toThrow('every ecosystem deployment address')
	})

	test('requires quorum 2 across three independent read origins for live execution', async () => {
		const configured = await configuredExample()
		const privateKey = `0x${'22'.repeat(32)}` as const
		const deploymentAddress = '0x0000000000000000000000000000000000000001'
		const live = {
			...configured,
			deployment: Object.fromEntries(Object.keys(record(configured['deployment'])).map(key => [key, deploymentAddress])),
			privateKey,
			runtime: { ...record(configured['runtime']), execute: true },
		}

		expect(() => parseSettings(live)).toThrow('Live execution requires RPC quorum 2 with three independent read origins')
		expect(() =>
			parseSettings({
				...live,
				connectivity: {
					...record(configured['connectivity']),
					quorumRpcUrls: ['https://quorum-one.example'],
					rpcQuorum: 2,
				},
			}),
		).toThrow('Live execution requires RPC quorum 2 with three independent read origins')
		expect(() =>
			parseSettings({
				...live,
				connectivity: {
					...record(configured['connectivity']),
					quorumRpcUrls: ['https://quorum-one.example', 'https://quorum-two.example'],
					rpcQuorum: 2,
				},
			}),
		).not.toThrow()
		expect(() =>
			parseSettings({
				...live,
				connectivity: {
					...record(configured['connectivity']),
					quorumRpcUrls: ['https://read.example/second-provider', 'https://quorum-two.example'],
					rpcQuorum: 2,
				},
			}),
		).toThrow('changing only the URL path does not create an independent provider')
	})

	test('enforces the one-to-sixty-minute delay and distinct-delay ranges', async () => {
		const example = await storedExample()
		expect(() => parseSettings({ ...example, scheduler: { maximumDelaySeconds: 3_601, minimumDelaySeconds: 60 } })).toThrow('maximumDelaySeconds')
		expect(() => parseSettings({ ...example, scheduler: { maximumDelaySeconds: 60, minimumDelaySeconds: 60 } })).toThrow('maximumDelaySeconds')
		expect(() => parseSettings({ ...example, scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 59 } })).toThrow('minimumDelaySeconds')
	})

	test('writes configuration atomically with owner-only permissions and detects revision conflicts', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'operator.json')
		const settings = parseSettings(await storedExample())
		await saveSettings(path, settings)
		expect((await stat(path)).mode & 0o777).toBe(0o600)
		const loaded = await loadSettings(path)
		await chmod(path, 0o644)
		await writeFile(path, `${JSON.stringify({ ...(await storedExample()), paused: true }, undefined, 2)}\n`, { mode: 0o644 })
		await expect(saveSettings(path, { ...loaded.settings, paused: false }, loaded.revision)).rejects.toMatchObject({ name: CONFIGURATION_REVISION_CONFLICT })
		expect((await stat(path)).mode & 0o777).toBe(0o644)
	})

	test('serializes same-process configuration writers before applying revision checks', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'operator.json')
		const settings = parseSettings(await storedExample())
		await saveSettings(path, settings)
		const loaded = await loadSettings(path)
		let activeReads = 0
		let peakReads = 0
		const delayedFilesystem: SettingsFilesystem = {
			mkdir,
			open,
			readFile: async (target, encoding) => {
				activeReads += 1
				peakReads = Math.max(peakReads, activeReads)
				try {
					await Bun.sleep(25)
					return await readFile(target, encoding)
				} finally {
					activeReads -= 1
				}
			},
			rename,
			rm,
		}
		const first = saveSettings(path, { ...loaded.settings, scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 61 } }, loaded.revision, delayedFilesystem)
		const second = saveSettings(path, { ...loaded.settings, scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 62 } }, loaded.revision, delayedFilesystem)
		const results = await Promise.allSettled([first, second])
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
		expect(results.filter(result => result.status === 'rejected').map(result => result.reason)).toEqual([expect.objectContaining({ name: CONFIGURATION_REVISION_CONFLICT })])
		expect(peakReads).toBe(1)
	})

	test('rejects chain profiles that share a durable state path through aliases', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'operator.json')
		const statePath = join(directory, 'state.json')
		const example = await storedExample()
		const base = parseSettings({ ...example, runtime: { ...record(example['runtime']), stateFile: statePath } })
		const mainnet = parseSettings({
			...serializedSettings(base),
			network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' },
			runtime: { ...serializedSettings(base).runtime, stateFile: statePath },
		})
		await saveSettings(settingsProfilePath(path, 'mainnet'), mainnet)
		await expect(assertSettingsProfileIsolation(path, base)).rejects.toThrow('distinct durable state paths')
	})

	test('replaces permissive configuration permissions on the next successful save', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'operator.json')
		const settings = parseSettings(await storedExample())
		await saveSettings(path, settings)
		await chmod(path, 0o644)
		await saveSettings(path, settings)
		expect((await stat(path)).mode & 0o777).toBe(0o600)
	})

	test('refuses permissive or symbolic-link configuration files before reading secrets', async () => {
		const directory = await temporaryDirectory()
		const path = join(directory, 'operator.json')
		const alias = join(directory, 'operator-alias.json')
		await saveSettings(path, parseSettings(await storedExample()))
		await chmod(path, 0o644)
		await expect(loadSettings(path)).rejects.toThrow('owner-only mode 0600')
		await chmod(path, 0o600)
		await symlink(path, alias)
		await expect(loadSettings(alias)).rejects.toThrow('must not be a symbolic link')
	})
})

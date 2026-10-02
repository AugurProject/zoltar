import { canonicalExecutorIdentity } from '#execution/executor-identity'
import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment, canonicalNetworkDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import example from '../../config/operator.example.json'
import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONFIGURATION_REVISION_CONFLICT, type RevisionedFileFilesystem } from '@zoltar/bot-shared/config/durable-file'
import type { Hex } from '@zoltar/bot-shared/ethereum'
import { durableJournalPaths, loadOperatorSettings, loadOperatorSettingsWithRevision, parseOperatorSettings, saveOperatorSettings, serializeOperatorSettings, switchOperatorNetworkProfile } from '#config/settings-store'
import { networkProfilePath } from '@zoltar/bot-shared/config/profiles'
import { executorDeploymentIntentPath } from '#execution/executor-deployment-store'
import { parseSettlementSettings, settlementJournalPath } from '#state/settlement-store'

const temporaryDirectories: string[] = []
const privateKey = `0x${'11'.repeat(32)}` as Hex

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

function settings(privateKeyValue: Hex | undefined) {
	return {
		approvedUniverses: [],
		centralizedMarkets: {
			assetAddress: canonicalNetworkDeployment(mainnet).rep,
			assetChainId: 1,
			assetSymbol: 'REP',
			depthBps: 500n,
			maximumDexDeviationBps: 1_000n,
			maximumObservationAgeMilliseconds: 30_000,
			maximumVenueDispersionBps: 500n,
			minimumAskDepthAttoEth: 0n,
			minimumBidDepthAttoEth: 0n,
			minimumSourceCount: 1,
			orderBookLimit: 20,
			requestTimeoutMilliseconds: 5_000,
			requiredForExecution: false,
			sources: [],
		},
		connectivity: {
			publicRpcUrls: ['https://submit-one.example/', 'https://submit-two.example/'],
			quorumRpcUrls: ['https://quorum.example/'],
			readRpcUrl: 'https://read.example/',
			rpcQuorum: 2 as const,
		},
		deployment: {
			coordinatorAddresses: [],
			executor: canonicalExecutorIdentity().address,
			openOracle: canonicalCoreDeployment(mainnet).openOracle,
			rep: canonicalNetworkDeployment(mainnet).rep,
			uniswapV2Enabled: false,
			uniswapV3Enabled: true,
			uniswapV4Enabled: false,
			uniswapFactory: canonicalUniswapDeployment(1).factory,
			uniswapQuoter: canonicalUniswapDeployment(1).quoter,
			uniswapRouter: canonicalUniswapDeployment(1).router,
			uniswapV2Router: undefined,
			uniswapV4PoolManager: undefined,
			uniswapV4Quoter: undefined,
			weth: canonicalNetworkDeployment(mainnet).weth,
		},
		network: 'mainnet' as const,
		networkConfigured: true,
		paused: true,
		privateKey: privateKeyValue,
		runtime: {
			execute: false,
			historyFile: '.state/history.jsonl',
			logLookbackBlocks: 256n,
			maxHedgeSlippageBps: 50n,
			once: false,
			pollMilliseconds: 15_000,
			positionFile: '.state/positions.json',
			priceHistoryFile: '.state/prices.jsonl',
			riskLimits: {
				lifecycleGasReserveAttoWeth: 10n ** 16n,
				maxConcurrentPositions: 1,
				maxDailyGasSpendAttoWeth: 5n * 10n ** 16n,
				maxPositionNotionalAttoWeth: 5n * 10n ** 18n,
				maxTotalLockedAttoWeth: 10n * 10n ** 18n,
			},
			ui: true,
			uiHost: '127.0.0.1' as const,
			uiPort: 4173,
		},
		settlement: parseSettlementSettings(undefined),
		strategy: {
			maxSpotTwapTicks: 75n,
			minimumProfitBps: 200n,
			minimumProfitAttoWeth: 25n * 10n ** 15n,
			minimumRemainingBlocks: 4n,
			minimumRemainingSeconds: 48n,
			twapSeconds: 2_400,
		},
		submission: {
			minimumBundleRelaySuccesses: 1,
			mode: 'private' as const,
			relayUrls: ['https://relay.flashbots.net/', 'https://relay.example/'],
		},
		tokenAddresses: ['0x0000000000000000000000000000000000000001' as const],
	}
}

const version4Runtime = {
	execute: false,
	historyFile: '.state/history-mainnet.jsonl',
	lookbackBlocks: '128',
	maxHedgeSlippageBps: '75',
	once: false,
	positionFile: '.state/positions-mainnet.json',
	priceHistoryFile: '.state/prices-mainnet.jsonl',
	riskLimits: { lifecycleGasReserveWeth: '0.01', maxConcurrentPositions: 1, maxDailyGasSpendWeth: '0.05', maxPositionNotionalWeth: '5', maxTotalLockedWeth: '10' },
	ui: true,
	uiHost: '127.0.0.1',
	uiPort: 4173,
}

/** A complete version 4 operator file as earlier releases and the dashboard saved it. */
function version4Document(overrides: { connectivity?: unknown; rpcQuorum?: unknown } = {}) {
	return {
		...example,
		connectivity: { publicRpcUrls: ['https://submit.example'], readRpcUrl: 'https://read.example' },
		deployment: { quorumRpcUrls: ['https://second.example', 'https://third.example'], uniswapV2Enabled: false, uniswapV3Enabled: true, uniswapV4Enabled: false },
		network: 'mainnet',
		networkConfigured: true,
		rpcQuorum: 2,
		runtime: version4Runtime,
		strategy: { maxSpotTwapTicks: '100', minimumProfitBps: '150', minimumProfitWeth: '0.01', minimumRemainingBlocks: '3', minimumRemainingSeconds: '36', pollMilliseconds: 15_000, twapSeconds: 1_800 },
		version: 4,
		...overrides,
	}
}

describe('operator settings version 4 migration', () => {
	test('moves RPC quorum into connectivity, the poll interval into runtime, and stores numeric lookback and basis points', () => {
		const parsed = parseOperatorSettings(version4Document())
		expect(parsed.connectivity).toEqual({ publicRpcUrls: ['https://submit.example/'], quorumRpcUrls: ['https://second.example/', 'https://third.example/'], readRpcUrl: 'https://read.example/', rpcQuorum: 2 })
		expect(parsed.runtime).toMatchObject({ logLookbackBlocks: 128n, maxHedgeSlippageBps: 75n, pollMilliseconds: 15_000 })
		expect(parsed.strategy.minimumProfitBps).toBe(150n)
		const serialized = serializeOperatorSettings(parsed)
		expect(serialized.version).toBe(5)
		expect(serialized).not.toHaveProperty('rpcQuorum')
		expect(serialized.connectivity).toEqual({ publicRpcUrls: ['https://submit.example/'], quorumRpcUrls: ['https://second.example/', 'https://third.example/'], readRpcUrl: 'https://read.example/', rpcQuorum: 2 })
		expect(serialized.deployment).toEqual({ uniswapV2Enabled: false, uniswapV3Enabled: true, uniswapV4Enabled: false })
		expect(serialized.runtime).toMatchObject({ logLookbackBlocks: 128, maxHedgeSlippageBps: 75, pollMilliseconds: 15_000 })
		expect(serialized.runtime).not.toHaveProperty('lookbackBlocks')
		expect(serialized.strategy).toMatchObject({ minimumProfitBps: 150 })
		expect(serialized.strategy).not.toHaveProperty('pollMilliseconds')
		expect(parseOperatorSettings(serialized)).toEqual(parsed)
	})

	test('keeps the version 4 lookback repair and the environment RPC policy default', () => {
		expect(parseOperatorSettings({ ...version4Document(), runtime: { ...version4Runtime, lookbackBlocks: '50000' } }).runtime.logLookbackBlocks).toBe(256n)
		const { rpcQuorum: _rpcQuorum, ...withoutPolicy } = version4Document()
		const previous = process.env['ZOLTAR_BOT_RPC_QUORUM']
		try {
			process.env['ZOLTAR_BOT_RPC_QUORUM'] = '2'
			expect(parseOperatorSettings(withoutPolicy).connectivity.rpcQuorum).toBe(2)
		} finally {
			if (previous === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
			else process.env['ZOLTAR_BOT_RPC_QUORUM'] = previous
		}
	})

	test('drops quorum readers and policy that an unconfigured version 4 profile could not use', () => {
		const { connectivity: _connectivity, ...unconfigured } = version4Document({ rpcQuorum: 1 })
		const parsed = parseOperatorSettings({ ...unconfigured, networkConfigured: false, paused: true, runtime: { ...unconfigured.runtime, execute: false } })
		expect(parsed.networkConfigured).toBeFalse()
		expect(parsed.connectivity.quorumRpcUrls).toEqual([])
		expect(serializeOperatorSettings(parsed).connectivity).toBeUndefined()
	})

	test('loads a saved version 4 file from disk', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-v4-migration-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'operator.json')
		const document = version4Document()
		await writeFile(path, JSON.stringify({ ...document, runtime: { ...document.runtime, historyFile: join(directory, 'history.jsonl'), positionFile: join(directory, 'positions.json'), priceHistoryFile: join(directory, 'prices.jsonl') } }), { mode: 0o600 })
		expect((await loadOperatorSettings(path))?.connectivity.rpcQuorum).toBe(2)
	})

	test('rejects the version 4 keys in a version 5 file', () => {
		const current = serializeOperatorSettings(parseOperatorSettings(version4Document()))
		expect(() => parseOperatorSettings({ ...current, rpcQuorum: 2 })).toThrow('Unknown operator configuration field: rpcQuorum')
		expect(() => parseOperatorSettings({ ...current, deployment: { ...current.deployment, quorumRpcUrls: [] } })).toThrow('Deployment settings require the supported core deployment fields')
		expect(() => parseOperatorSettings({ ...current, runtime: { ...current.runtime, lookbackBlocks: '256' } })).toThrow('Runtime settings require exactly the supported runtime fields')
		expect(() => parseOperatorSettings({ ...current, runtime: { ...current.runtime, maxHedgeSlippageBps: '50' } })).toThrow('Runtime maxHedgeSlippageBps must be an integer from 0 to 1000')
		expect(() => parseOperatorSettings({ ...current, runtime: { ...current.runtime, logLookbackBlocks: '256' } })).toThrow('Runtime logLookbackBlocks must be an integer from 0 to 256')
		expect(() => parseOperatorSettings({ ...current, strategy: { ...current.strategy, minimumProfitBps: '100' } })).toThrow('Minimum return must be an integer from 0 to 100000')
		expect(() => parseOperatorSettings({ ...current, strategy: { ...current.strategy, pollMilliseconds: 1_000 } })).toThrow('Unknown strategy setting: pollMilliseconds')
		for (const version of [3, 6, '5']) expect(() => parseOperatorSettings({ ...current, version })).toThrow('unsupported version')
	})
})

describe('operator settings persistence', () => {
	test('keeps complete settings and durable journal paths isolated while switching chain profiles', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-profiles-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'operator.json')
		const mainnet = settings(undefined)
		mainnet.strategy.minimumProfitBps = 777n
		mainnet.runtime.historyFile = join(directory, 'mainnet-history.jsonl')
		mainnet.runtime.positionFile = join(directory, 'mainnet-positions.json')
		mainnet.runtime.priceHistoryFile = join(directory, 'mainnet-prices.jsonl')
		await saveOperatorSettings(path, mainnet)
		const sepolia = await switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))
		expect(sepolia.settings).toMatchObject({ network: 'sepolia', networkConfigured: false, paused: true, privateKey: undefined })
		expect(sepolia.settings.runtime.historyFile).toContain('.sepolia.')
		expect(sepolia.settings.runtime.positionFile).not.toBe(mainnet.runtime.positionFile)
		await saveOperatorSettings(path, { ...sepolia.settings, strategy: { ...sepolia.settings.strategy, minimumProfitBps: 333n } })
		const restored = await switchOperatorNetworkProfile(path, 'mainnet', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))
		expect(restored.settings.strategy.minimumProfitBps).toBe(777n)
		expect(restored.settings.runtime.historyFile).toBe(mainnet.runtime.historyFile)
		expect(restored.settings.runtime.positionFile).toBe(mainnet.runtime.positionFile)
	})

	test('rejects durable journals that reuse the executor deployment intent before writing', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-reserved-executor-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'operator.json')
		const reservedPath = executorDeploymentIntentPath(path, 'mainnet')
		const mainnet = settings(undefined)
		mainnet.runtime.historyFile = join(directory, 'mainnet-history.jsonl')
		mainnet.runtime.positionFile = join(directory, 'mainnet-positions.json')
		mainnet.runtime.priceHistoryFile = join(directory, 'mainnet-prices.jsonl')
		const sepolia = {
			...mainnet,
			centralizedMarkets: { ...mainnet.centralizedMarkets, assetChainId: 11_155_111 },
			network: 'sepolia' as const,
			runtime: { ...mainnet.runtime, historyFile: reservedPath, positionFile: join(directory, 'sepolia-positions.json'), priceHistoryFile: join(directory, 'sepolia-prices.jsonl') },
		}
		await saveOperatorSettings(path, mainnet)
		await saveOperatorSettings(networkProfilePath(path, 'sepolia'), sepolia)
		const activeBefore = await readFile(path, 'utf8')
		const targetBefore = await readFile(networkProfilePath(path, 'sepolia'), 'utf8')
		await expect(switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Durable journal paths must not reuse configuration, profile, or executor deployment intent files')
		expect(await readFile(path, 'utf8')).toBe(activeBefore)
		expect(await readFile(networkProfilePath(path, 'sepolia'), 'utf8')).toBe(targetBefore)
	})

	test('defaults existing configuration files to the primary-reader RPC policy', () => {
		const serialized = serializeOperatorSettings(settings(undefined))
		const { rpcQuorum: _rpcQuorum, ...connectivity } = serialized.connectivity ?? {}
		expect(parseOperatorSettings({ ...serialized, connectivity }).connectivity.rpcQuorum).toBe(1)
	})

	test('migrates a configuration file without a saved RPC policy from the shared ZOLTAR_BOT_RPC_QUORUM default', () => {
		const stored = serializeOperatorSettings(settings(undefined))
		const { rpcQuorum: _rpcQuorum, ...connectivity } = stored.connectivity ?? {}
		const serialized = { ...stored, connectivity }
		const previous = process.env['ZOLTAR_BOT_RPC_QUORUM']
		try {
			process.env['ZOLTAR_BOT_RPC_QUORUM'] = '2'
			expect(parseOperatorSettings(serialized).connectivity.rpcQuorum).toBe(2)
			process.env['ZOLTAR_BOT_RPC_QUORUM'] = '3'
			expect(() => parseOperatorSettings(serialized)).toThrow('ZOLTAR_BOT_RPC_QUORUM must be 1 or 2')
		} finally {
			if (previous === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
			else process.env['ZOLTAR_BOT_RPC_QUORUM'] = previous
		}
	})

	test('keeps settlement disabled for configuration files that predate the block and round-trips an enabled one', () => {
		const serialized = serializeOperatorSettings(settings(undefined))
		expect(serialized.settlement).toEqual({ enabled: false, maxGasPriceNanoEth: '50', minimumProfitWeth: '0.001', rewardWithdrawThresholdEth: '0.01' })
		const { settlement: _omitted, ...legacy } = serialized
		expect(parseOperatorSettings(legacy).settlement).toEqual(parseSettlementSettings(undefined))
		const enabled = { ...serialized, settlement: { enabled: true, maxGasPriceNanoEth: '8', minimumProfitWeth: '0.002', rewardWithdrawThresholdEth: '0.05' } }
		const parsed = parseOperatorSettings(enabled)
		expect(parsed.settlement).toEqual({ enabled: true, maxGasPriceAttoEthPerGas: 8_000_000_000n, minimumProfitAttoWeth: 2n * 10n ** 15n, rewardWithdrawThresholdAttoEth: 5n * 10n ** 16n })
		expect(serializeOperatorSettings(parsed).settlement).toEqual(enabled.settlement)
		expect(() => parseOperatorSettings({ ...serialized, settlement: { enabled: true } })).toThrow('Every settlement setting is required')
	})

	test('validates and persists the dashboard RPC quorum policy', () => {
		const serialized = serializeOperatorSettings(settings(undefined))
		for (const rpcQuorum of [null, '1', 0, 3]) expect(() => parseOperatorSettings({ ...serialized, connectivity: { ...serialized.connectivity, rpcQuorum } })).toThrow('connectivity.rpcQuorum must be 1 or 2')
		expect(parseOperatorSettings({ ...serialized, connectivity: { ...serialized.connectivity, rpcQuorum: 1 } }).connectivity.rpcQuorum).toBe(1)
	})

	test('permits live execution with only the primary read RPC by default', () => {
		const value = settings(privateKey)
		const serialized = serializeOperatorSettings({ ...value, connectivity: { ...value.connectivity, quorumRpcUrls: [], rpcQuorum: 1 } })
		const parsed = parseOperatorSettings({ ...serialized, runtime: { ...serialized.runtime, execute: true } })
		expect(parsed.connectivity.quorumRpcUrls).toEqual([])
	})

	test('requires independent readers when the two-reader policy is explicitly enabled', () => {
		const value = settings(privateKey)
		const serialized = serializeOperatorSettings({ ...value, connectivity: { ...value.connectivity, quorumRpcUrls: [], rpcQuorum: 2 } })
		expect(() => parseOperatorSettings({ ...serialized, runtime: { ...serialized.runtime, execute: true } })).toThrow('at least two independent quorum RPCs')
	})

	test('atomically round-trips restart settings with owner-only permissions', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'nested', 'settings.json')
		await saveOperatorSettings(path, settings(privateKey))
		expect((await stat(path)).mode & 0o777).toBe(0o600)
		expect(await loadOperatorSettings(path)).toEqual(settings(privateKey))
	})

	test('loads only an owner-only regular configuration file', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-owner-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'settings.json')
		await saveOperatorSettings(path, settings(undefined))
		await chmod(path, 0o644)
		await expect(loadOperatorSettings(path)).rejects.toThrow('must have owner-only mode 0600')
		await chmod(path, 0o600)
		await symlink(path, join(directory, 'linked.json'))
		await expect(loadOperatorSettings(join(directory, 'linked.json'))).rejects.toThrow('must not be a symbolic link')
		expect(await loadOperatorSettings(join(directory, 'missing.json'))).toBeUndefined()
	})

	test('checks the expected revision at commit and returns the revision of the exact saved bytes', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'settings.json')
		await saveOperatorSettings(path, settings(undefined))
		const loaded = await loadOperatorSettingsWithRevision(path)
		if (loaded === undefined) throw new Error('Expected saved operator settings')
		const next = { ...settings(undefined), paused: false }
		const savedRevision = await saveOperatorSettings(path, next, undefined, loaded.revision)
		expect((await loadOperatorSettingsWithRevision(path))?.revision).toBe(savedRevision)

		const current = await loadOperatorSettingsWithRevision(path)
		if (current === undefined) throw new Error('Expected saved operator settings')
		let replacedBeforeCommit = false
		const filesystem: RevisionedFileFilesystem = {
			mkdir,
			open,
			readFile: async (readPath, encoding) => {
				if (readPath === path && !replacedBeforeCommit) {
					replacedBeforeCommit = true
					const external = (await readFile(path, 'utf8')).replace('"paused": false', '"paused": true')
					await writeFile(path, external, { encoding: 'utf8', mode: 0o600 })
				}
				return readFile(readPath, encoding)
			},
			rename,
			rm,
		}
		const conflict = saveOperatorSettings(path, { ...next, runtime: { ...next.runtime, uiPort: 4180 } }, filesystem, current.revision)
		await expect(conflict).rejects.toMatchObject({ name: CONFIGURATION_REVISION_CONFLICT })
		expect((await loadOperatorSettings(path))?.paused).toBe(true)
		expect((await loadOperatorSettings(path))?.runtime.uiPort).toBe(4173)
	})

	test('does not write an unremembered signer and removes a previously remembered signer', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'settings.json')
		await saveOperatorSettings(path, settings(privateKey))
		await saveOperatorSettings(path, settings(undefined))
		const contents = await readFile(path, 'utf8')
		expect(contents).not.toContain(privateKey)
		expect(await loadOperatorSettings(path)).toEqual(settings(undefined))
	})

	test('fails closed for malformed, unknown, or unsupported settings', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-settings-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'settings.json')
		expect(await loadOperatorSettings(path)).toBeUndefined()
		await writeFile(path, 'not json', { encoding: 'utf8', mode: 0o600 })
		expect(loadOperatorSettings(path)).rejects.toThrow('not valid JSON')
		await saveOperatorSettings(path, settings(undefined))
		const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
		await writeFile(path, JSON.stringify({ ...parsed, unexpected: true }), { encoding: 'utf8', mode: 0o600 })
		expect(loadOperatorSettings(path)).rejects.toThrow('Unknown operator configuration field')
		await writeFile(path, JSON.stringify({ ...parsed, version: 6 }), { encoding: 'utf8', mode: 0o600 })
		expect(loadOperatorSettings(path)).rejects.toThrow('unsupported version')
	})

	test('bounds coordinator-free event discovery to the latest 0 through 256 blocks', () => {
		const serialized = serializeOperatorSettings(settings(undefined))
		for (const logLookbackBlocks of [0, 256]) expect(parseOperatorSettings({ ...serialized, runtime: { ...serialized.runtime, logLookbackBlocks } }).runtime.logLookbackBlocks).toBe(BigInt(logLookbackBlocks))
		for (const logLookbackBlocks of [-1, 257, 50_000]) expect(() => parseOperatorSettings({ ...serialized, runtime: { ...serialized.runtime, logLookbackBlocks } })).toThrow('Runtime logLookbackBlocks must be an integer from 0 to 256')
	})

	test('rejects persistent runtime files that resolve to the same path', () => {
		const value = settings(undefined)
		expect(() =>
			parseOperatorSettings(
				serializeOperatorSettings({
					...value,
					runtime: { ...value.runtime, positionFile: '.state/shared.jsonl', priceHistoryFile: '.state/nested/../shared.jsonl' },
				}),
			),
		).toThrow('must use distinct paths')
	})

	test('rejects a configured journal that aliases the settlement journal derived from the position file', () => {
		const value = settings(undefined)
		expect(durableJournalPaths(value.runtime)).toContain(settlementJournalPath(value.runtime.positionFile))
		for (const key of ['historyFile', 'priceHistoryFile'] as const) {
			expect(() => parseOperatorSettings(serializeOperatorSettings({ ...value, runtime: { ...value.runtime, [key]: '.state/nested/../positions.json.settlements' } }))).toThrow('derived settlement journal must use distinct paths')
		}
	})

	test('rejects a dormant profile whose journal aliases the active chain settlement journal through a symlinked directory', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-profile-settlement-alias-'))
		temporaryDirectories.push(directory)
		const durableDirectory = join(directory, 'durable')
		const durableAlias = join(directory, 'durable-alias')
		await mkdir(durableDirectory)
		await symlink(durableDirectory, durableAlias, 'dir')
		const path = join(directory, 'operator.json')
		const mainnet = settings(undefined)
		mainnet.runtime.historyFile = join(durableDirectory, 'mainnet-history.jsonl')
		mainnet.runtime.positionFile = join(durableDirectory, 'mainnet-positions.json')
		mainnet.runtime.priceHistoryFile = join(durableDirectory, 'mainnet-prices.jsonl')
		// The Sepolia price history points at the mainnet settlement journal through the alias; nothing configured collides directly.
		const sepolia = {
			...mainnet,
			centralizedMarkets: { ...mainnet.centralizedMarkets, assetChainId: 11_155_111 },
			network: 'sepolia' as const,
			runtime: { ...mainnet.runtime, historyFile: join(durableAlias, 'sepolia-history.jsonl'), positionFile: join(durableAlias, 'sepolia-positions.json'), priceHistoryFile: join(durableAlias, 'mainnet-positions.json.settlements') },
		}
		await saveOperatorSettings(path, mainnet)
		await saveOperatorSettings(networkProfilePath(path, 'sepolia'), sepolia)
		await expect(switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Mainnet and Sepolia profiles must use distinct durable journal paths')
		expect((await loadOperatorSettings(path))?.network).toBe('mainnet')
	})
})

for (const [network, manifest] of [
	['mainnet', mainnet],
	['sepolia', sepolia],
] as const) {
	test(`loads the ${network} canonical oracle from an existing zero-address configuration`, () => {
		const parsed = parseOperatorSettings({ ...example, network, deployment: { ...example.deployment, openOracle: '0x0000000000000000000000000000000000000000' }, centralizedMarkets: { ...example.centralizedMarkets, assetChainId: 999 } })
		expect(parsed.deployment.openOracle).toBe(canonicalCoreDeployment(manifest).openOracle)
		expect(parsed.centralizedMarkets.assetAddress).toBe(canonicalNetworkDeployment(manifest).rep)
		expect(parsed.centralizedMarkets.assetChainId).toBe(manifest.network.chainId)
		expect(serializeOperatorSettings(parsed).centralizedMarkets).not.toHaveProperty('assetAddress')
		expect(serializeOperatorSettings(parsed).centralizedMarkets).not.toHaveProperty('assetChainId')
		expect(serializeOperatorSettings(parsed).deployment).not.toHaveProperty('rep')
		expect(serializeOperatorSettings(parsed).deployment).not.toHaveProperty('weth')
		expect(serializeOperatorSettings(parsed).deployment).not.toHaveProperty('openOracle')
		expect(parseOperatorSettings(serializeOperatorSettings(parsed)).deployment.openOracle).toBe(parsed.deployment.openOracle)
	})
}

test('universe approvals round-trip independently of monitoring tokens and missing approval defaults to none', () => {
	const stored = serializeOperatorSettings({ ...settings(undefined), approvedUniverses: [0n, 123n] })
	expect(parseOperatorSettings(stored).approvedUniverses).toEqual([0n, 123n])
	const { approvedUniverses, ...withoutApprovals } = stored
	expect(approvedUniverses).toEqual(['0', '123'])
	expect(parseOperatorSettings(withoutApprovals).approvedUniverses).toEqual([])
})

test('preserves default router intent through serialized network changes', () => {
	const mainnet = parseOperatorSettings(example)
	const serialized = JSON.parse(JSON.stringify(serializeOperatorSettings(mainnet)))
	const sepolia = parseOperatorSettings({ ...serialized, network: 'sepolia' })
	expect(sepolia.deployment.uniswapV2Router).toBeUndefined()
	const restored = parseOperatorSettings({ ...JSON.parse(JSON.stringify(serializeOperatorSettings(sepolia))), network: 'mainnet' })
	expect(restored.deployment.uniswapV2Router).toBe(mainnet.deployment.uniswapV2Router)
	expect(restored.deployment.uniswapV2Router).toBeDefined()
})

test('stores only venue switches and derives addresses again on load', () => {
	const parsed = parseOperatorSettings({ ...example, deployment: { ...example.deployment, uniswapV2Enabled: false, uniswapV3Enabled: true, uniswapV4Enabled: true } })
	const stored = serializeOperatorSettings(parsed)
	expect(stored.deployment).toEqual({ uniswapV2Enabled: false, uniswapV3Enabled: true, uniswapV4Enabled: true })
	expect(parseOperatorSettings(JSON.parse(JSON.stringify(stored))).deployment).toEqual(parsed.deployment)
})

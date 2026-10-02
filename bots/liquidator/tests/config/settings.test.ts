import mainnetManifest from '../../../../docs/mainnet-deployment-addresses.json'
import example from '../../config/operator.example.json'
import sepoliaManifest from '../../../../docs/sepolia-deployment-addresses.json'
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { parseDesiredPools, parseSettings, parseStrategy, serializedSettings } from '../../src/config/settings.ts'
import { loadSettings, saveSettings, switchSettingsNetworkProfile } from '../../src/config/settings-store.ts'
import { storedStrategyFixture } from '../support/strategy-settings.ts'

// Pool creation follows deposits so the serialized key order matches what the round-trip test compares byte for byte.
const { allowAutomaticDeposits, ...storedStrategy } = storedStrategyFixture()

const settings = {
	approvedUniverses: ['0'],
	centralizedMarkets: {
		assetAddress: '0x0000000000000000000000000000000000000000',
		assetChainId: 11155111,
		assetSymbol: 'REP',
		depthBps: 500,
		maximumDexDeviationBps: 1000,
		maximumObservationAgeMilliseconds: 30000,
		maximumVenueDispersionBps: 500,
		minimumAskDepthEth: '2',
		minimumBidDepthEth: '2',
		minimumSourceCount: 2,
		orderBookLimit: 20,
		requestTimeoutMilliseconds: 5000,
		requiredForExecution: false,
		sources: [],
	},
	connectivity: {
		publicRpcUrls: ['https://public.example'],
		quorumRpcUrls: [],
		readRpcUrl: 'https://read.example',
		rpcQuorum: 1,
	},
	deployment: {
		securityPoolFactory: '0x0000000000000000000000000000000000000000',
		weth: '0x0000000000000000000000000000000000000000',
		zoltar: '0x0000000000000000000000000000000000000000',
	},
	network: {
		chainId: 11155111,
		explorerUrl: 'https://sepolia.etherscan.io',
		name: 'sepolia',
	},
	paused: false,
	privateKey: null,
	runtime: {
		execute: false,
		historicalLogRecovery: false,
		logLookbackBlocks: 256,
		once: false,
		pollMilliseconds: 12000,
		stateFile: '.state/operator-state.json',
		ui: true,
		uiHost: '127.0.0.1',
		uiPort: 4183,
	},
	selectedPools: [],
	strategy: { allowAutomaticDeposits, allowAutomaticPoolCreation: false, ...storedStrategy },
	submission: {
		minimumBundleRelaySuccesses: 1,
		mode: 'public',
		relayUrls: [],
	},
	version: 2,
}

describe('liquidator settings', () => {
	test('derives Sepolia roots instead of loading zero or obsolete address overrides', () => {
		const zoltar = sepoliaManifest.deploymentSteps.find(step => step.id === 'zoltar')
		if (zoltar === undefined) throw new Error('Canonical Sepolia Zoltar is missing')
		for (const deployment of [undefined, settings.deployment, { zoltar: '0x0000000000000000000000000000000000000001' }]) {
			const parsed = parseSettings({ ...settings, deployment })
			expect(parsed.deployment.zoltar).toBe(getAddress(zoltar.address))
			expect(parsed.deployment.weth).toBe(getAddress(sepoliaManifest.network.wethAddress))
			expect(Object.values(parsed.deployment)).not.toContain('0x0000000000000000000000000000000000000000')
			expect(serializedSettings(parsed)).not.toHaveProperty('deployment')
		}
	})

	test('keeps settings and durable recovery state isolated while switching chain profiles', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-profiles-'))
		try {
			const path = join(directory, 'operator.json')
			const mainnet = parseSettings({
				...settings,
				centralizedMarkets: { ...settings.centralizedMarkets, assetChainId: 1 },
				connectivity: { ...settings.connectivity, quorumRpcUrls: ['https://mainnet-quorum-a.example', 'https://mainnet-quorum-b.example'], rpcQuorum: 2 },
				network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' },
				runtime: { ...settings.runtime, stateFile: join(directory, 'mainnet-state.json') },
				strategy: { ...settings.strategy, maximumGasCostEth: '0.777' },
			})
			await saveSettings(path, mainnet)
			const sepolia = await switchSettingsNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))
			expect(sepolia.settings).toMatchObject({ network: { name: 'sepolia' }, networkConfigured: false, paused: true, privateKey: undefined })
			expect(sepolia.settings.runtime.stateFile).toContain('.sepolia.')
			expect(sepolia.settings.deployment.weth).toBe(getAddress(sepoliaManifest.network.wethAddress))
			expect(sepolia.settings.centralizedMarkets.assetAddress).toBe(getAddress(sepoliaManifest.network.genesisRepTokenAddress))
			expect(sepolia.settings.centralizedMarkets.assetChainId).toBe(sepoliaManifest.network.chainId)
			expect(sepolia.settings.deployment).not.toEqual(mainnet.deployment)
			await saveSettings(
				path,
				{
					...sepolia.settings,
					connectivity: { publicRpcUrls: ['https://sepolia-public.example'], quorumRpcUrls: [], readRpcUrl: 'https://sepolia-read.example', rpcQuorum: 1 },
					networkConfigured: true,
					strategy: { ...sepolia.settings.strategy, maximumGasCostAttoEth: 333n },
				},
				sepolia.revision,
			)
			const restored = await switchSettingsNetworkProfile(path, 'mainnet', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))
			expect(restored.settings.strategy.maximumGasCostAttoEth).toBe(777_000_000_000_000_000n)
			expect(restored.settings.connectivity.rpcQuorum).toBe(2)
			expect(restored.settings.runtime.stateFile).toBe(mainnet.runtime.stateFile)
			const restoredSepolia = await switchSettingsNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))
			expect(restoredSepolia.settings.connectivity.rpcQuorum).toBe(1)
			expect((await loadSettings(path)).settings.network.name).toBe('sepolia')
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('loads only an owner-only regular configuration file', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-owner-only-'))
		try {
			const path = join(directory, 'operator.json')
			await saveSettings(path, parseSettings(settings))
			await chmod(path, 0o644)
			await expect(loadSettings(path)).rejects.toThrow('must have owner-only mode 0600')
			await chmod(path, 0o600)
			const linked = join(directory, 'linked.json')
			await symlink(path, linked)
			await expect(loadSettings(linked)).rejects.toThrow('must not be a symbolic link')
			await expect(loadSettings(join(directory, 'missing.json'))).rejects.toThrow(/Missing liquidator configuration.*install -m 600 config\/operator.example.json/)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('writes a memory-only live signer as a paused dry-run file so a restart cannot execute without its key', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-restart-safe-'))
		try {
			const path = join(directory, 'operator.json')
			const live = { ...parseSettings(settings), paused: false, runtime: { ...parseSettings(settings).runtime, execute: true } }
			await saveSettings(path, live)
			const reloaded = await loadSettings(path)
			expect(reloaded.settings.runtime.execute).toBe(false)
			expect(reloaded.settings.paused).toBe(true)
			expect(reloaded.settings.privateKey).toBeUndefined()
			await saveSettings(path, { ...live, privateKey: `0x${'11'.repeat(32)}` })
			const saved = await loadSettings(path)
			expect(saved.settings.runtime.execute).toBe(true)
			expect(saved.settings.paused).toBe(false)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('round trips the operator configuration without losing decimal precision', () => {
		const parsed = parseSettings(settings)
		expect(parsed.strategy.maximumGasCostAttoEth).toBe(2n * 10n ** 16n)
		expect(parsed.strategy.maximumAttoRepPerPool).toBe(10_000n * 10n ** 18n)
		expect(parsed.strategy.minimumLiquidationDebtAttoEth).toBe(10n ** 18n)
		expect(parsed.strategy.walletAttoRepReserve).toBe(100n * 10n ** 18n)
		const serialized = serializedSettings(parsed)
		expect(serialized.strategy.maximumGasCostEth).toBe('0.02')
		expect(serialized.strategy.maximumPerPoolRep).toBe('10000')
		expect(JSON.stringify(serialized.strategy)).toBe(JSON.stringify(settings.strategy))
		expect(serialized.connectivity).toEqual({
			publicRpcUrls: ['https://public.example/'],
			quorumRpcUrls: [],
			readRpcUrl: 'https://read.example/',
			rpcQuorum: 1,
		})
		expect(serialized.runtime.stateFile.endsWith('/bots/liquidator/.state/operator-state.json')).toBe(true)
		expect(serialized.runtime).toMatchObject({ historicalLogRecovery: false, logLookbackBlocks: 256 })
		expect(serialized.approvedUniverses).toEqual(['0'])
	})

	test('bounds the normal log window to the latest 1 through 256 blocks', () => {
		for (const logLookbackBlocks of [1, 256]) expect(parseSettings({ ...settings, runtime: { ...settings.runtime, logLookbackBlocks } }).runtime.logLookbackBlocks).toBe(logLookbackBlocks)
		for (const logLookbackBlocks of [0, 257]) expect(() => parseSettings({ ...settings, runtime: { ...settings.runtime, logLookbackBlocks } })).toThrow('runtime.logLookbackBlocks must be an integer from 1 through 256')
	})

	test('rejects overlapping health-management thresholds', () => {
		expect(() =>
			parseStrategy({
				...settings.strategy,
				vaultTargetHealthBps: 15000,
				vaultWithdrawHealthBps: 15000,
			}),
		).toThrow('Withdrawal health must exceed target health')
	})

	test('rejects contradictory network name and chain identity', () => {
		expect(() =>
			parseSettings({
				...settings,
				network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'mainnet' },
			}),
		).toThrow('name and chainId must identify the same supported chain')
	})

	test('rejects an explicitly empty RPC quorum policy during settings parsing', () => {
		const previous = process.env['ZOLTAR_BOT_RPC_QUORUM']
		try {
			process.env['ZOLTAR_BOT_RPC_QUORUM'] = ''
			const { rpcQuorum: _rpcQuorum, ...legacyConnectivity } = settings.connectivity
			expect(() => parseSettings({ ...settings, connectivity: legacyConnectivity })).toThrow('ZOLTAR_BOT_RPC_QUORUM must be 1 or 2')
		} finally {
			if (previous === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
			else process.env['ZOLTAR_BOT_RPC_QUORUM'] = previous
		}
	})

	test('permits live execution with only the primary read RPC by default', () => {
		const parsed = parseSettings({
			...settings,
			deployment: {
				securityPoolFactory: '0x0000000000000000000000000000000000000001',
				weth: '0x0000000000000000000000000000000000000002',
				zoltar: '0x0000000000000000000000000000000000000003',
			},
			privateKey: `0x${'11'.repeat(32)}`,
			runtime: { ...settings.runtime, execute: true },
		})
		expect(parsed.connectivity.quorumRpcUrls).toEqual([])
	})

	test('requires independent readers when the two-reader policy is explicitly enabled', () => {
		const previous = process.env['ZOLTAR_BOT_RPC_QUORUM']
		try {
			process.env['ZOLTAR_BOT_RPC_QUORUM'] = '2'
			expect(() =>
				parseSettings({
					...settings,
					connectivity: { ...settings.connectivity, rpcQuorum: 2 },
					privateKey: `0x${'11'.repeat(32)}`,
					runtime: { ...settings.runtime, execute: true },
				}),
			).toThrow('at least two independent quorum RPCs')
		} finally {
			if (previous === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
			else process.env['ZOLTAR_BOT_RPC_QUORUM'] = previous
		}
	})

	test('uses canonical WETH for live execution despite saved placeholders', () => {
		expect(
			parseSettings({
				...settings,
				connectivity: {
					...settings.connectivity,
					quorumRpcUrls: ['https://quorum-a.example', 'https://quorum-b.example'],
				},
				deployment: {
					...settings.deployment,
					securityPoolFactory: '0x0000000000000000000000000000000000000001',
					zoltar: '0x0000000000000000000000000000000000000002',
				},
				privateKey: `0x${'11'.repeat(32)}`,
				runtime: { ...settings.runtime, execute: true },
			}).deployment.weth,
		).toBe(getAddress(sepoliaManifest.network.wethAddress))
	})

	test('parses desired origin pools and exact child REP market configurations', () => {
		const childMarket = { ...settings.centralizedMarkets, assetAddress: '0x0000000000000000000000000000000000000011' }
		const parsed = parseSettings({
			...settings,
			childMarketConfigurations: [childMarket],
			desiredPools: [{ initialReportPriorityFeeAttoEthPerGas: '1000000000', questionId: '7', statoblastSecurityMultiplierBps: 12500, universeId: '0' }],
		})
		expect(parsed.childMarketConfigurations[0]?.assetAddress).toBe(getAddress(childMarket.assetAddress))
		expect(parsed.desiredPools[0]).toEqual({ initialReportPriorityFeeAttoEthPerGas: 1_000_000_000n, questionId: 7n, statoblastSecurityMultiplierBps: 12_500n, universeId: 0n })
	})
})

for (const manifest of [mainnetManifest, sepoliaManifest]) {
	test(`derives the ${manifest.network.id} root market identity and omits it from saved settings`, () => {
		const parsed = parseSettings({ ...example, centralizedMarkets: { ...example.centralizedMarkets, assetAddress: '0x0000000000000000000000000000000000000001', assetChainId: 999 }, network: { name: manifest.network.id, chainId: manifest.network.chainId, explorerUrl: 'https://example.com' } })
		expect(parsed.centralizedMarkets.assetAddress).toBe(getAddress(manifest.network.genesisRepTokenAddress))
		expect(parsed.centralizedMarkets.assetChainId).toBe(manifest.network.chainId)
		expect(serializedSettings(parsed).centralizedMarkets).not.toHaveProperty('assetAddress')
		expect(serializedSettings(parsed).centralizedMarkets).not.toHaveProperty('assetChainId')
		expect(parseSettings(serializedSettings(parsed)).centralizedMarkets).toEqual(parsed.centralizedMarkets)
	})
}

for (const [field, bits] of [
	['universeId', 248],
	['questionId', 256],
	['initialReportPriorityFeeAttoEthPerGas', 256],
] as const) {
	test(`desired pool ${field} preserves unsigned syntax, bounds, and errors`, () => {
		const pool = { initialReportPriorityFeeAttoEthPerGas: '0', questionId: '0', statoblastSecurityMultiplierBps: 12500, universeId: '0' }
		const parse = (value: unknown) => parseDesiredPools([{ ...pool, [field]: value }])
		const maximum = 2n ** BigInt(bits) - 1n
		expect(parse(maximum.toString())[0]?.[field]).toBe(maximum)
		expect(parse('0')[0]?.[field]).toBe(0n)
		expect(() => parse((maximum + 1n).toString())).toThrow(`desiredPools[0].${field} must fit in uint${bits}`)
		for (const value of [-1, 0, undefined, '', '-1', '+1', '01', ' 1', '1 ', '1.0', '1e2', '0x10']) {
			expect(() => parse(value)).toThrow(`desiredPools[0].${field} must be a non-negative integer string`)
		}
	})
}

test('desired pool statoblastSecurityMultiplierBps is a JSON number above 10000 basis points', () => {
	const pool = { initialReportPriorityFeeAttoEthPerGas: '0', questionId: '0', statoblastSecurityMultiplierBps: 12500, universeId: '0' }
	const parse = (value: unknown) => parseDesiredPools([{ ...pool, statoblastSecurityMultiplierBps: value }])
	expect(parse(10_001)[0]?.statoblastSecurityMultiplierBps).toBe(10_001n)
	expect(parse(Number.MAX_SAFE_INTEGER)[0]?.statoblastSecurityMultiplierBps).toBe(BigInt(Number.MAX_SAFE_INTEGER))
	for (const value of ['12500', 10_000, 12_500.5, Number.MAX_SAFE_INTEGER + 1, undefined]) expect(() => parse(value)).toThrow('desiredPools[0].statoblastSecurityMultiplierBps must be an integer from 10001 through')
	expect(serializedSettings(parseSettings({ ...settings, desiredPools: [pool] })).desiredPools[0]?.statoblastSecurityMultiplierBps).toBe(12_500)
})

describe('liquidator settings migration', () => {
	const version1 = { ...settings, desiredPools: [{ initialReportPriorityFeeAttoEthPerGas: '1000000000', questionId: '7', statoblastSecurityMultiplierBps: '12500', universeId: '0' }], version: 1 }

	test('migrates a version 1 file whose basis-point pool multiplier is a string to the version 2 shape', async () => {
		const parsed = parseSettings(version1)
		expect(parsed.version).toBe(2)
		expect(parsed.desiredPools[0]?.statoblastSecurityMultiplierBps).toBe(12_500n)
		const serialized = serializedSettings(parsed)
		expect(serialized.version).toBe(2)
		expect(serialized.desiredPools).toEqual([{ initialReportPriorityFeeAttoEthPerGas: '1000000000', questionId: '7', statoblastSecurityMultiplierBps: 12_500, universeId: '0' }])
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-migration-'))
		try {
			const path = join(directory, 'operator.json')
			await writeFile(path, JSON.stringify(version1), { mode: 0o600 })
			expect((await loadSettings(path)).settings.desiredPools[0]?.statoblastSecurityMultiplierBps).toBe(12_500n)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects the version 1 string multiplier in a version 2 file and unknown versions', () => {
		expect(() => parseSettings({ ...version1, version: 2 })).toThrow('desiredPools[0].statoblastSecurityMultiplierBps must be an integer')
		for (const version of [0, 3, '2', undefined]) expect(() => parseSettings({ ...settings, version })).toThrow('operator settings version must be 1 or 2')
	})
})

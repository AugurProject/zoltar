import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { getAddress } from '../helpers/ethereum.ts'
import { assertSettingsProfileIsolation, loadSettings, parseSettings, parseStrategy, saveSettings, serializedSettings, settingsProfilePath, switchSettingsNetworkProfile, type SettingsFilesystem } from '../../src/config/settings.ts'

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
		maxVaultsPerPool: 1000,
		once: false,
		pollMilliseconds: 12000,
		stateFile: '.state/operator-state.json',
		ui: true,
		uiHost: '127.0.0.1',
		uiPort: 4183,
	},
	selectedPools: [],
	strategy: {
		allowAutomaticDeposits: true,
		allowAutomaticPoolCreation: false,
		allowAutomaticVaultMigrations: true,
		allowAutomaticWithdrawals: true,
		candidatePriority: 'largest-bonus',
		fallbackRepPerEthPrice: '0',
		maximumGasCostEth: '0.02',
		maximumLiquidationDebtEth: '25',
		maximumOracleRequestCostEth: '0.02',
		maximumPerPoolRep: '10000',
		maximumTotalDeployedRep: '25000',
		minimumLiquidationDebtEth: '1',
		minimumRepWithdrawalRep: '10',
		minimumRewardValueEth: '0.02',
		redeemFeesAboveEth: '0.01',
		stalePriceFundingBufferBps: 15000,
		stagedOperationValidForSeconds: 240,
		vaultTargetHealthBps: 12500,
		vaultTopUpHealthBps: 11000,
		vaultWithdrawHealthBps: 15000,
		walletReserveRep: '100',
	},
	submission: {
		minimumBundleRelaySuccesses: 1,
		mode: 'public',
		relayUrls: [],
	},
	version: 1,
}

describe('liquidator settings', () => {
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

	test('rejects a dormant profile that reuses the active chain recovery state', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-profile-collision-'))
		try {
			const path = join(directory, 'operator.json')
			const mainnet = parseSettings({ ...settings, centralizedMarkets: { ...settings.centralizedMarkets, assetChainId: 1 }, network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }, runtime: { ...settings.runtime, stateFile: join(directory, 'shared-state.json') } })
			const sepolia = parseSettings({ ...settings, network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' }, runtime: { ...settings.runtime, stateFile: mainnet.runtime.stateFile } })
			await saveSettings(path, mainnet)
			await saveSettings(settingsProfilePath(path, 'sepolia'), sepolia)
			await expect(switchSettingsNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Mainnet and Sepolia profiles must use distinct durable recovery state paths')
			expect((await loadSettings(path)).settings).toMatchObject({ network: { name: 'mainnet' }, runtime: { stateFile: mainnet.runtime.stateFile } })
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects cross-chain recovery state reached through symlinked directory aliases', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-profile-symlink-'))
		try {
			const durableDirectory = join(directory, 'durable')
			const durableAlias = join(directory, 'durable-alias')
			await mkdir(durableDirectory)
			await symlink(durableDirectory, durableAlias, 'dir')
			const path = join(directory, 'operator.json')
			const mainnet = parseSettings({ ...settings, centralizedMarkets: { ...settings.centralizedMarkets, assetChainId: 1 }, network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }, runtime: { ...settings.runtime, stateFile: join(durableDirectory, 'shared-state.json') } })
			const sepolia = parseSettings({ ...settings, runtime: { ...settings.runtime, stateFile: join(durableAlias, 'shared-state.json') } })
			await saveSettings(path, mainnet)
			await saveSettings(settingsProfilePath(path, 'sepolia'), sepolia)
			await expect(switchSettingsNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Mainnet and Sepolia profiles must use distinct durable recovery state paths')
			expect((await loadSettings(path)).settings.network.name).toBe('mainnet')
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects cross-chain recovery state reached through distinct dangling symlinks to one file before writing', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-profile-dangling-symlink-'))
		try {
			const sharedTarget = join(directory, 'missing-shared-state.json')
			const mainnetAlias = join(directory, 'mainnet-state-alias.json')
			const sepoliaAlias = join(directory, 'sepolia-state-alias.json')
			await symlink(sharedTarget, mainnetAlias)
			await symlink(sharedTarget, sepoliaAlias)
			const path = join(directory, 'operator.json')
			const mainnet = parseSettings({ ...settings, centralizedMarkets: { ...settings.centralizedMarkets, assetChainId: 1 }, network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }, runtime: { ...settings.runtime, stateFile: mainnetAlias } })
			const sepolia = parseSettings({ ...settings, runtime: { ...settings.runtime, stateFile: sepoliaAlias } })
			await saveSettings(path, mainnet)
			await saveSettings(settingsProfilePath(path, 'sepolia'), sepolia)
			const files = [path, settingsProfilePath(path, 'sepolia')]
			const before = await Promise.all(files.map(file => readFile(file, 'utf8')))
			await expect(switchSettingsNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Mainnet and Sepolia profiles must use distinct durable recovery state paths')
			expect(await Promise.all(files.map(file => readFile(file, 'utf8')))).toEqual(before)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects recovery state that reuses configuration and profile files before writing', async () => {
		for (const reservedName of ['active', 'mainnet', 'sepolia'] as const) {
			const directory = await mkdtemp(join(tmpdir(), `zoltar-liquidator-reserved-${reservedName}-`))
			try {
				const path = join(directory, 'operator.json')
				const reservedPath = reservedName === 'active' ? path : settingsProfilePath(path, reservedName)
				const mainnet = parseSettings({ ...settings, centralizedMarkets: { ...settings.centralizedMarkets, assetChainId: 1 }, network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }, runtime: { ...settings.runtime, stateFile: join(directory, 'mainnet-state.json') } })
				const sepolia = parseSettings({ ...settings, network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' }, runtime: { ...settings.runtime, stateFile: reservedPath } })
				await saveSettings(path, mainnet)
				await saveSettings(settingsProfilePath(path, 'sepolia'), sepolia)
				const activeBefore = await readFile(path, 'utf8')
				const targetBefore = await readFile(settingsProfilePath(path, 'sepolia'), 'utf8')
				await expect(switchSettingsNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('The durable recovery state path must not reuse the active configuration or chain profile files')
				expect(await readFile(path, 'utf8')).toBe(activeBefore)
				expect(await readFile(settingsProfilePath(path, 'sepolia'), 'utf8')).toBe(targetBefore)
			} finally {
				await rm(directory, { force: true, recursive: true })
			}
		}
	})

	test('does not overwrite a profile file reused by the active chain as recovery state', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-active-reserved-'))
		try {
			const path = join(directory, 'operator.json')
			const mainnetProfile = settingsProfilePath(path, 'mainnet')
			const active = parseSettings({ ...settings, centralizedMarkets: { ...settings.centralizedMarkets, assetChainId: 1 }, network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }, runtime: { ...settings.runtime, stateFile: mainnetProfile } })
			const savedMainnet = { ...active, runtime: { ...active.runtime, stateFile: join(directory, 'mainnet-state.json') } }
			const sepolia = parseSettings({ ...settings, network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' }, runtime: { ...settings.runtime, stateFile: join(directory, 'sepolia-state.json') } })
			await saveSettings(path, active)
			await saveSettings(mainnetProfile, savedMainnet)
			await saveSettings(settingsProfilePath(path, 'sepolia'), sepolia)
			const files = [path, mainnetProfile, settingsProfilePath(path, 'sepolia')]
			const before = await Promise.all(files.map(file => readFile(file, 'utf8')))
			await expect(switchSettingsNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('The durable recovery state path must not reuse the active configuration or chain profile files')
			expect(await Promise.all(files.map(file => readFile(file, 'utf8')))).toEqual(before)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects a sibling profile whose embedded chain identity does not match its filename', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-profile-identity-'))
		try {
			const path = join(directory, 'operator.json')
			const mainnet = parseSettings({ ...settings, centralizedMarkets: { ...settings.centralizedMarkets, assetChainId: 1 }, network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }, runtime: { ...settings.runtime, stateFile: join(directory, 'mainnet-state.json') } })
			await saveSettings(path, mainnet)
			await saveSettings(settingsProfilePath(path, 'sepolia'), mainnet)
			const activeBefore = await readFile(path, 'utf8')
			const targetBefore = await readFile(settingsProfilePath(path, 'sepolia'), 'utf8')
			await expect(assertSettingsProfileIsolation(path, mainnet)).rejects.toThrow('The sepolia profile contains mainnet settings')
			await expect(switchSettingsNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('The sepolia profile contains mainnet settings')
			expect(await readFile(path, 'utf8')).toBe(activeBefore)
			expect(await readFile(settingsProfilePath(path, 'sepolia'), 'utf8')).toBe(targetBefore)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects an existing profile with a different process mode or dashboard binding before writing', async () => {
		for (const runtimeOverride of [{ once: true }, { ui: false }, { uiHost: '0.0.0.0' as const }, { uiPort: 4999 }]) {
			const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-profile-process-mode-'))
			try {
				const path = join(directory, 'operator.json')
				const mainnet = parseSettings({ ...settings, centralizedMarkets: { ...settings.centralizedMarkets, assetChainId: 1 }, network: { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }, runtime: { ...settings.runtime, stateFile: join(directory, 'mainnet-state.json') } })
				const sepolia = parseSettings({ ...settings, network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' }, runtime: { ...settings.runtime, ...runtimeOverride, stateFile: join(directory, 'sepolia-state.json') } })
				await saveSettings(path, mainnet)
				await saveSettings(settingsProfilePath(path, 'sepolia'), sepolia)
				const activeBefore = await readFile(path, 'utf8')
				const targetBefore = await readFile(settingsProfilePath(path, 'sepolia'), 'utf8')
				await expect(switchSettingsNetworkProfile(path, 'sepolia', join(import.meta.dir, '..', '..', 'config', 'operator.example.json'))).rejects.toThrow('Chain profiles must use the same once mode and dashboard binding to switch in place')
				expect(await readFile(path, 'utf8')).toBe(activeBefore)
				expect(await readFile(settingsProfilePath(path, 'sepolia'), 'utf8')).toBe(targetBefore)
			} finally {
				await rm(directory, { force: true, recursive: true })
			}
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

	test('requires a deployed WETH contract for live execution', () => {
		expect(() =>
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
			}),
		).toThrow('deployed WETH contract')
	})

	test('parses desired origin pools and exact child REP market configurations', () => {
		const childMarket = { ...settings.centralizedMarkets, assetAddress: '0x0000000000000000000000000000000000000011' }
		const parsed = parseSettings({
			...settings,
			childMarketConfigurations: [childMarket],
			desiredPools: [{ initialReportPriorityFeeAttoEthPerGas: '1000000000', questionId: '7', statoblastSecurityMultiplierBps: '12500', universeId: '0' }],
		})
		expect(parsed.childMarketConfigurations[0]?.assetAddress).toBe(getAddress(childMarket.assetAddress))
		expect(parsed.desiredPools[0]).toEqual({ initialReportPriorityFeeAttoEthPerGas: 1_000_000_000n, questionId: 7n, statoblastSecurityMultiplierBps: 12_500n, universeId: 0n })
	})

	test('syncs the configuration and parent directory before returning success', async () => {
		const parsed = parseSettings(settings)
		const current = `${JSON.stringify(serializedSettings(parsed), undefined, 2)}\n`
		const expectedRevision = createHash('sha256').update(current).digest('hex')
		const events: string[] = []
		const filesystem: SettingsFilesystem = {
			mkdir: async () => events.push('mkdir'),
			open: async (_path, flags) => ({
				close: async () => events.push(`${flags}:close`),
				sync: async () => events.push(`${flags}:sync`),
				writeFile: async () => events.push(`${flags}:write`),
			}),
			readFile: async () => current,
			rename: async () => events.push('rename'),
			rm: async () => events.push('rm'),
		}
		await saveSettings('/state/operator.json', parsed, expectedRevision, filesystem)
		expect(events).toEqual(['mkdir', 'wx:write', 'wx:sync', 'wx:close', 'rename', 'r:sync', 'r:close'])
	})
})

import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAddress } from '../helpers/ethereum.ts'
import { loadSettings, parseSettings, parseStrategy, saveSettings, serializedSettings, settingsForPersistence, type SettingsFilesystem } from '../../src/config/settings.ts'

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
		})
		expect(serialized.runtime.stateFile.endsWith('/bots/liquidator/.state/operator-state.json')).toBe(true)
		expect(serialized.approvedUniverses).toEqual(['0'])
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

	test('requires independent quorum reads for live execution', () => {
		expect(() =>
			parseSettings({
				...settings,
				privateKey: `0x${'11'.repeat(32)}`,
				runtime: { ...settings.runtime, execute: true },
			}),
		).toThrow('independent quorum RPC')
	})

	test('uses the environment RPC list for every RPC role', () => {
		const parsed = parseSettings(settings, 'https://primary.example,https://secondary.example')
		expect(parsed.connectivity).toEqual({
			publicRpcUrls: ['https://primary.example/', 'https://secondary.example/'],
			quorumRpcUrls: ['https://secondary.example/'],
			readRpcUrl: 'https://primary.example/',
		})
	})

	test('rejects an environment quorum that repeats the primary RPC', () => {
		expect(() => parseSettings(settings, 'https://primary.example,https://primary.example')).toThrow('independent origins')
	})

	test('keeps file RPC fallbacks after saving an unrelated environment-overridden setting', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-rpc-environment-'))
		try {
			const path = join(directory, 'operator.json')
			await writeFile(path, JSON.stringify(settings), 'utf8')
			const loaded = await loadSettings(path, 'https://primary.example,https://secondary.example')
			expect(loaded.settings.connectivity.readRpcUrl).toBe('https://primary.example/')
			await saveSettings(path, settingsForPersistence({ ...loaded.settings, paused: true }, loaded.persistedConnectivity), loaded.revision)
			const reloaded = await loadSettings(path, '')
			expect(reloaded.settings.paused).toBe(true)
			expect(reloaded.settings.connectivity).toEqual({
				publicRpcUrls: ['https://public.example/'],
				quorumRpcUrls: [],
				readRpcUrl: 'https://read.example/',
			})
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('allows environment quorum RPCs to satisfy live execution without changing an empty file fallback', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-live-rpc-environment-'))
		try {
			const path = join(directory, 'operator.json')
			const liveSettings = {
				...settings,
				deployment: {
					securityPoolFactory: '0x0000000000000000000000000000000000000001',
					weth: '0x0000000000000000000000000000000000000002',
					zoltar: '0x0000000000000000000000000000000000000003',
				},
				privateKey: `0x${'11'.repeat(32)}`,
				runtime: { ...settings.runtime, execute: true },
			}
			await writeFile(path, JSON.stringify(liveSettings), 'utf8')
			const loaded = await loadSettings(path, 'https://primary.example,https://secondary.example')
			expect(loaded.settings.connectivity.quorumRpcUrls).toEqual(['https://secondary.example/'])
			expect(loaded.persistedConnectivity.quorumRpcUrls).toEqual([])
			await saveSettings(path, settingsForPersistence({ ...loaded.settings, paused: true }, loaded.persistedConnectivity), loaded.revision)
			const savedDocument = JSON.parse(await Bun.file(path).text()) as { connectivity: { quorumRpcUrls: string[]; readRpcUrl: string } }
			expect(savedDocument.connectivity).toMatchObject({ quorumRpcUrls: [], readRpcUrl: 'https://read.example/' })
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('requires a deployed WETH contract for live execution', () => {
		expect(() =>
			parseSettings({
				...settings,
				connectivity: {
					...settings.connectivity,
					quorumRpcUrls: ['https://quorum.example'],
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

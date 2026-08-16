import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { getAddress } from '../helpers/ethereum.ts'
import { parseSettings, parseStrategy, saveSettings, serializedSettings, type SettingsFilesystem } from '../../src/config/settings.ts'

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
			expect(() => parseSettings(settings)).toThrow('ZOLTAR_BOT_RPC_QUORUM must be 1 or 2')
		} finally {
			if (previous === undefined) delete process.env['ZOLTAR_BOT_RPC_QUORUM']
			else process.env['ZOLTAR_BOT_RPC_QUORUM'] = previous
		}
	})

	test('requires independent quorum reads for live execution', () => {
		expect(() =>
			parseSettings({
				...settings,
				connectivity: { ...settings.connectivity, quorumRpcUrls: ['https://quorum.example'] },
				privateKey: `0x${'11'.repeat(32)}`,
				runtime: { ...settings.runtime, execute: true },
			}),
		).toThrow('at least two independent quorum RPCs')
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

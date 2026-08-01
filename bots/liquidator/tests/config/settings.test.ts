import { describe, expect, test } from 'bun:test'
import { getAddress } from '../helpers/ethereum.ts'
import { parseSettings, parseStrategy, serializedSettings } from '../../src/config/settings.ts'

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
		maximumRepPerPool: '10000',
		maximumTotalDeployedRep: '25000',
		minimumLiquidationDebtEth: '1',
		minimumRepWithdrawal: '10',
		minimumRewardValueEth: '0.02',
		redeemFeesAboveEth: '0.01',
		stalePriceFundingBufferBps: 15000,
		stagedOperationValidForSeconds: 240,
		vaultTargetHealthBps: 12500,
		vaultTopUpHealthBps: 11000,
		vaultWithdrawHealthBps: 15000,
		walletRepReserve: '100',
	},
	submission: {
		minimumRelaySuccesses: 1,
		mode: 'public',
		relayUrls: [],
	},
	version: 1,
}

describe('liquidator settings', () => {
	test('round trips the operator configuration without losing decimal precision', () => {
		const parsed = parseSettings(settings)
		const serialized = serializedSettings(parsed)
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
			desiredPools: [{ initialReportPriorityFeeWeiPerGas: '1000000000', questionId: '7', statoblastSecurityMultiplierBps: '12500', universeId: '0' }],
		})
		expect(parsed.childMarketConfigurations[0]?.assetAddress).toBe(getAddress(childMarket.assetAddress))
		expect(parsed.desiredPools[0]).toEqual({ initialReportPriorityFeeWeiPerGas: 1_000_000_000n, questionId: 7n, statoblastSecurityMultiplierBps: 12_500n, universeId: 0n })
	})
})

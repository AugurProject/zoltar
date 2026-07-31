import { describe, expect, test } from 'bun:test'
import { parseSettings, parseStrategy, serializedSettings } from '../../src/config/settings.ts'

const settings = {
	approvedUniverses: ['0'],
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
})

import { describe, expect, test } from 'bun:test'
import { parseSettings, type OperatorSettings } from '#config/settings'
import { updateNetworkConnectivity } from '#core/network-connectivity'

async function exampleSettings() {
	return parseSettings(JSON.parse(await Bun.file(new URL('../../config/operator.example.json', import.meta.url)).text()))
}

const request = (network: 'mainnet' | 'sepolia', quorumRpcUrls = ['https://quorum-a.example/', 'https://quorum-b.example/']) => ({
	connectivity: {
		publicRpcUrls: ['https://public.example/'],
		quorumRpcUrls,
		readRpcUrl: 'https://read.example/',
	},
	network,
})

type NetworkConnectivityChecks = NonNullable<Parameters<typeof updateNetworkConnectivity>[0]['checks']>

function healthyChecks(chainId: number): Awaited<ReturnType<NetworkConnectivityChecks['checkConnectivity']>> {
	return [{ chainId, checkedAt: '2026-08-12T00:00:00.000Z', error: undefined, kind: 'read-rpc', status: 'healthy', target: 'read.example' }]
}

describe('network connectivity updates', () => {
	test('accepts a dashboard update with only the primary read RPC by default', async () => {
		const settings = await exampleSettings()
		settings.runtime.execute = true
		const next = await updateNetworkConnectivity({
			apply: () => undefined,
			checks: { checkConnectivity: async () => healthyChecks(1), readRpcChainId: async () => 1 },
			persist: async update => update(settings),
			settings,
			value: request('mainnet', []),
		})
		expect(next.connectivity.quorumRpcUrls).toEqual([])
	})

	test('checks, persists, and applies initial network configuration with every market chain ID coupled', async () => {
		const settings = await exampleSettings()
		settings.childMarketConfigurations = [{ ...settings.centralizedMarkets, assetAddress: '0x0000000000000000000000000000000000000001' }]
		let checkedChainId: number | undefined
		let persisted: OperatorSettings | undefined
		let applied: OperatorSettings | undefined
		const next = await updateNetworkConnectivity({
			apply: value => {
				applied = value
			},
			checks: {
				checkConnectivity: async (_connectivity, chainId) => {
					checkedChainId = chainId
					return healthyChecks(chainId)
				},
				readRpcChainId: async () => 1,
			},
			persist: async update => {
				const value = update(settings)
				persisted = value
				return value
			},
			settings,
			value: request('mainnet'),
		})
		expect(checkedChainId).toBe(1)
		expect(next.network).toEqual({ chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' })
		expect(next.centralizedMarkets.assetChainId).toBe(1)
		expect(next.childMarketConfigurations.map(configuration => configuration.assetChainId)).toEqual([1])
		expect(persisted).toBe(next)
		expect(applied).toBe(next)
	})

	test('rejects a wrong-chain quorum endpoint before persistence or application', async () => {
		const settings = await exampleSettings()
		let persisted = false
		let applied = false
		await expect(
			updateNetworkConnectivity({
				apply: () => {
					applied = true
				},
				checks: { checkConnectivity: async () => healthyChecks(1), readRpcChainId: async () => 11_155_111 },
				persist: async () => {
					persisted = true
					return settings
				},
				settings,
				value: request('mainnet'),
			}),
		).rejects.toThrow('returned chain 11155111')
		expect(persisted).toBe(false)
		expect(applied).toBe(false)
	})

	test('rejects a wrong-chain private relay before persistence or application', async () => {
		const settings = await exampleSettings()
		settings.submission = { minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: ['https://relay.example/'] }
		let persisted = false
		let applied = false
		await expect(
			updateNetworkConnectivity({
				apply: () => {
					applied = true
				},
				checks: {
					checkConnectivity: async () => healthyChecks(1),
					checkSubmissionEndpoints: async () => {
						throw new Error('Expected chain 1, received 11155111')
					},
					readRpcChainId: async () => 1,
				},
				persist: async () => {
					persisted = true
					return settings
				},
				settings,
				value: request('mainnet'),
			}),
		).rejects.toThrow('Expected chain 1')
		expect(persisted).toBe(false)
		expect(applied).toBe(false)
	})

	test('rejects a configured chain switch before endpoint checks or persistence', async () => {
		const settings = await exampleSettings()
		settings.networkConfigured = true
		settings.network = { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' }
		settings.runtime.execute = true
		let checked = false
		let persisted = false
		await expect(
			updateNetworkConnectivity({
				apply: () => undefined,
				checks: {
					checkConnectivity: async () => {
						checked = true
						return healthyChecks(1)
					},
					readRpcChainId: async () => 1,
				},
				persist: async () => {
					persisted = true
					return settings
				},
				settings,
				value: request('mainnet'),
			}),
		).rejects.toThrow('Select the chain profile before saving its RPC settings')
		expect(checked).toBe(false)
		expect(persisted).toBe(false)
	})

	test('does not mutate runtime state when persistence fails', async () => {
		const settings = await exampleSettings()
		let applied = false
		await expect(
			updateNetworkConnectivity({
				apply: () => {
					applied = true
				},
				checks: { checkConnectivity: async () => healthyChecks(1), readRpcChainId: async () => 1 },
				persist: async () => {
					throw new Error('disk unavailable')
				},
				settings,
				value: request('mainnet'),
			}),
		).rejects.toThrow('disk unavailable')
		expect(applied).toBe(false)
	})

	test('merges into the latest paused settings after delayed endpoint checks', async () => {
		const settings = await exampleSettings()
		settings.paused = false
		let current = settings
		let release: (() => void) | undefined
		const checking = new Promise<void>(resolve => {
			release = resolve
		})
		const update = updateNetworkConnectivity({
			apply: value => {
				current = value
			},
			checks: {
				checkConnectivity: async () => {
					await checking
					return healthyChecks(1)
				},
				readRpcChainId: async () => 1,
			},
			persist: async merge => {
				current = merge(current)
				return current
			},
			settings,
			value: request('mainnet'),
		})
		current = { ...current, paused: true }
		release?.()
		const next = await update
		expect(next.paused).toBe(true)
		expect(current.paused).toBe(true)
	})
})

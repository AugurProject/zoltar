import { canonicalExecutorIdentity } from '#execution/executor-identity'
import { executorArtifact } from '#contracts/artifacts.generated'
import { canonicalSecurityPoolFactory } from '#config/network'
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCoreDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { loadConfiguration } from '#config/configuration'
import { validateDeploymentSettings } from '#config/deployment-settings'
import { networkConfiguration } from '#config/network'
import { authenticateConfiguredDeployments } from '#config/runtime-deployment'
import { loadOperatorSettings, parseOperatorSettings, saveOperatorSettings, switchOperatorNetworkProfile } from '#config/settings-store'
import example from '../../config/operator.example.json'
import mainnet from '../../../../docs/mainnet-deployment-addresses.json'

const temporaryDirectories: string[] = []
const network = networkConfiguration('mainnet')
const uniswap = canonicalUniswapDeployment(1)
const openOracle = canonicalCoreDeployment(mainnet).openOracle
const executor = canonicalExecutorIdentity().address

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

for (const [name, v3, v4] of [
	['V3-only', true, false],
	['V3 and V4', true, true],
	['V4-only', false, true],
] as const) {
	test(`loads a current ${name} profile without changing venue intent`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'arbitrager-venue-migration-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'operator.json')

		// Current profiles store explicit venue switches.
		const runtime = example.runtime
		await writeFile(
			path,
			JSON.stringify({
				...example,
				network: 'mainnet',
				networkConfigured: true,
				connectivity: { readRpcUrl: 'https://primary.example', publicRpcUrls: ['https://submit.example'], quorumRpcUrls: ['https://second.example', 'https://third.example'], rpcQuorum: 1 },
				runtime: { ...runtime, execute: true, historyFile: join(directory, 'history.jsonl'), logLookbackBlocks: 256, maxHedgeSlippageBps: 50, positionFile: join(directory, 'positions.json'), priceHistoryFile: join(directory, 'prices.jsonl') },
				strategy: { ...example.strategy, minimumProfitBps: 100 },
				version: 5,
				deployment: { uniswapV2Enabled: false, uniswapV3Enabled: v3, uniswapV4Enabled: v4 },
			}),
			{ mode: 0o600 },
		)
		const config = await loadConfiguration(path)
		const allowed = new Set([openOracle, network.weth, canonicalSecurityPoolFactory('mainnet'), ...(v3 ? [uniswap.factory, uniswap.quoter, uniswap.router] : []), ...(v4 ? [uniswap.v4PoolManager, uniswap.v4Quoter] : [])].map(address => address.toLowerCase()))
		const client = createPublicClient({
			chain: network.chain,
			transport: custom({
				request: async ({ method, params }) => {
					if (method === 'eth_getCode' && Array.isArray(params) && typeof params[0] === 'string' && params[0].toLowerCase() === executor.toLowerCase()) return `0x${executorArtifact.evm.deployedBytecode.object}`
					if (method !== 'eth_getCode' || !Array.isArray(params) || typeof params[0] !== 'string' || !allowed.has(params[0].toLowerCase())) throw new Error('Unexpected deployment authentication')
					return '0x01'
				},
			}),
		})
		// A V3-only profile has no V2 router. Loading must not make that identity mandatory.
		await authenticateConfiguredDeployments([client], config, {})
		expect(config.operatorSettings.deployment).toMatchObject({ uniswapV2Enabled: false, uniswapV3Enabled: v3, uniswapV4Enabled: v4 })
		expect(config.router).toBe(v3 ? uniswap.router : undefined)
		expect(config.v2Router).toBeUndefined()
		expect(config.v4PoolManager).toBe(v4 ? uniswap.v4PoolManager : undefined)
		await saveOperatorSettings(path, config.operatorSettings)
		const stored = JSON.parse(await readFile(path, 'utf8'))
		expect(stored.deployment).toEqual({ uniswapV2Enabled: false, uniswapV3Enabled: v3, uniswapV4Enabled: v4 })
		expect(stored.connectivity.quorumRpcUrls).toEqual(['https://second.example/', 'https://third.example/'])
		expect(stored.version).toBe(5)
		expect((await loadOperatorSettings(path))?.deployment).toEqual(config.operatorSettings.deployment)
		await authenticateConfiguredDeployments([client], await loadConfiguration(path), {})
		// A new network profile gets template defaults; returning to the saved profile restores its choices.
		const fresh = await switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '../../config/operator.example.json'))
		expect(fresh.settings.deployment).toMatchObject({ uniswapV2Enabled: true, uniswapV3Enabled: true, uniswapV4Enabled: false })
		const restored = await switchOperatorNetworkProfile(path, 'mainnet', join(import.meta.dir, '../../config/operator.example.json'))
		expect(restored.settings.deployment).toEqual(config.operatorSettings.deployment)
	})
}

test('requires explicit venue switches', () => {
	expect(parseOperatorSettings(example).deployment).toMatchObject(example.deployment)
	for (const key of Object.keys(example.deployment)) {
		const incomplete = Object.fromEntries(Object.entries(example.deployment).filter(([name]) => name !== key))
		expect(() => validateDeploymentSettings(incomplete)).toThrow('must be a boolean')
	}
})

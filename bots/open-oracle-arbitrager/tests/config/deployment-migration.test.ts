import { canonicalExecutorIdentity } from '#execution/executor-identity'
import { executorArtifact } from '#contracts/artifacts.generated'
import { canonicalSecurityPoolFactory } from '#config/network'
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCoreDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import { createPublicClient, getAddress } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { loadConfiguration } from '#config/configuration'
import { createDeploymentManifest } from '../helpers/deployment-manifest.ts'
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
const coordinator = getAddress('0x0000000000000000000000000000000000000002')

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

for (const [name, v3, v4] of [
	['V3-only', true, false],
	['V3 and V4', true, true],
	['V4-only', false, true],
] as const) {
	test(`migrates a legacy ${name} profile without changing venue intent or additional bytecode pins`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'arbitrager-venue-migration-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'operator.json')
		const deploymentManifest = await createDeploymentManifest(
			'mainnet',
			1,
			[
				{ address: openOracle, role: 'open-oracle' },
				{ address: network.weth, role: 'weth' },
				{ address: canonicalSecurityPoolFactory('mainnet'), role: 'security-pool-factory' },
				{ address: coordinator, role: 'coordinator' },
				{ address: uniswap.factory, role: 'uniswap-factory' },
				{ address: uniswap.quoter, role: 'uniswap-quoter' },
				...(v3 ? [{ address: uniswap.router, role: 'uniswap-router' as const }] : []),
				...(v4
					? [
							{ address: uniswap.v4PoolManager, role: 'uniswap-v4-pool-manager' as const },
							{ address: uniswap.v4Quoter, role: 'uniswap-v4-quoter' as const },
						]
					: []),
			],
			async () => '0x01',
		)
		// Version 4 profiles stored optional addresses, with no enable switches. JSON omits disabled routers.
		await writeFile(
			path,
			JSON.stringify({
				...example,
				network: 'mainnet',
				networkConfigured: true,
				connectivity: { readRpcUrl: 'https://primary.example', publicRpcUrls: ['https://submit.example'] },
				runtime: { ...example.runtime, execute: true, historyFile: join(directory, 'history.jsonl'), positionFile: join(directory, 'positions.json'), priceHistoryFile: join(directory, 'prices.jsonl') },
				deployment: {
					coordinatorAddresses: [coordinator],
					executor,
					deploymentManifest,
					quorumRpcUrls: ['https://second.example', 'https://third.example'],
					uniswapFactory: uniswap.factory,
					uniswapQuoter: uniswap.quoter,
					uniswapRouter: v3 ? uniswap.router : undefined,
					uniswapV4PoolManager: v4 ? uniswap.v4PoolManager : undefined,
					uniswapV4Quoter: v4 ? uniswap.v4Quoter : undefined,
				},
			}),
		)
		const config = await loadConfiguration(path)
		const allowed = new Set(deploymentManifest.contracts.map(contract => contract.address.toLowerCase()))
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
		// A V3-only legacy manifest has no V2 router. Migration must not make that identity mandatory.
		await authenticateConfiguredDeployments([client], config)
		expect(config.operatorSettings.deployment).toMatchObject({ uniswapV2Enabled: false, uniswapV3Enabled: v3, uniswapV4Enabled: v4 })
		expect(config.router).toBe(v3 ? uniswap.router : undefined)
		expect(config.v2Router).toBeUndefined()
		expect(config.v4PoolManager).toBe(v4 ? uniswap.v4PoolManager : undefined)
		await saveOperatorSettings(path, config.operatorSettings)
		const stored = JSON.parse(await readFile(path, 'utf8'))
		expect(stored.deployment).toEqual({ deploymentManifest, quorumRpcUrls: config.quorumRpcUrls, uniswapV2Enabled: false, uniswapV3Enabled: v3, uniswapV4Enabled: v4 })
		expect((await loadOperatorSettings(path))?.deployment).toEqual(config.operatorSettings.deployment)
		await authenticateConfiguredDeployments([client], await loadConfiguration(path))
		// A new network profile gets template defaults; returning to the migrated profile restores its choices.
		const fresh = await switchOperatorNetworkProfile(path, 'sepolia', join(import.meta.dir, '../../config/operator.example.json'))
		expect(fresh.settings.deployment).toMatchObject({ uniswapV2Enabled: true, uniswapV3Enabled: true, uniswapV4Enabled: false })
		const restored = await switchOperatorNetworkProfile(path, 'mainnet', join(import.meta.dir, '../../config/operator.example.json'))
		expect(restored.settings.deployment).toEqual(config.operatorSettings.deployment)
	})
}

for (const empty of [undefined, null, '']) {
	test(`preserves disabled legacy routers represented by ${String(empty)}`, () => {
		const migrated = validateDeploymentSettings({ coordinatorAddresses: [], quorumRpcUrls: [], uniswapRouter: empty, uniswapV2Router: empty, uniswapV4PoolManager: empty, uniswapV4Quoter: empty })
		expect(migrated).toMatchObject({ uniswapV2Enabled: false, uniswapV3Enabled: false, uniswapV4Enabled: false })
	})
}

test('new-profile defaults remain explicit while omitted legacy routers remain disabled', () => {
	expect(parseOperatorSettings(example).deployment).toMatchObject({ uniswapV2Enabled: true, uniswapV3Enabled: true, uniswapV4Enabled: false })
	expect(validateDeploymentSettings({ coordinatorAddresses: [], quorumRpcUrls: [] })).toMatchObject({ uniswapV2Enabled: false, uniswapV3Enabled: false, uniswapV4Enabled: false })
})

test('explicit switches take precedence over legacy addresses', () => {
	expect(validateDeploymentSettings({ ...example.deployment, uniswapV2Router: uniswap.v2Router, uniswapRouter: undefined, uniswapV4PoolManager: uniswap.v4PoolManager, uniswapV4Quoter: uniswap.v4Quoter, uniswapV2Enabled: false, uniswapV3Enabled: true, uniswapV4Enabled: false })).toMatchObject({
		uniswapV2Enabled: false,
		uniswapV3Enabled: true,
		uniswapV4Enabled: false,
	})
})

test('rejects incomplete legacy V4 enablement instead of silently disabling it', () => {
	for (const pair of [{ uniswapV4PoolManager: uniswap.v4PoolManager }, { uniswapV4Quoter: uniswap.v4Quoter }]) expect(() => validateDeploymentSettings({ coordinatorAddresses: [], quorumRpcUrls: [], ...pair })).toThrow('both PoolManager and Quoter')
})

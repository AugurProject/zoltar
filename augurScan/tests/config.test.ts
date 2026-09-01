import { afterEach, describe, expect, test } from 'bun:test'
import mainnetDeployment from '../../docs/mainnet-deployment-addresses.json'
import sepoliaDeployment from '../../docs/sepolia-deployment-addresses.json'
import mainnetManifest from '../config/manifests/mainnet.json'
import sepoliaManifest from '../config/manifests/sepolia.json'
import { loadNetworks, parseManifestValue, runtimeConfig } from '../src/config.ts'

const originalNetworks = process.env['NETWORKS']
const originalMainnetRpc = process.env['MAINNET_RPC_URL']
const originalStart = process.env['SEPOLIA_START_BLOCK']
const originalRpc = process.env['SEPOLIA_RPC_URL']
const originalAmmFactory = process.env['SEPOLIA_AMM_FACTORY_ADDRESS']
const originalV2Factory = process.env['MAINNET_UNISWAP_V2_FACTORY_ADDRESS']
const originalV4Manager = process.env['SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS']

afterEach(() => {
	if (originalNetworks === undefined) delete process.env['NETWORKS']
	else process.env['NETWORKS'] = originalNetworks
	if (originalMainnetRpc === undefined) delete process.env['MAINNET_RPC_URL']
	else process.env['MAINNET_RPC_URL'] = originalMainnetRpc
	if (originalStart === undefined) delete process.env['SEPOLIA_START_BLOCK']
	else process.env['SEPOLIA_START_BLOCK'] = originalStart
	if (originalRpc === undefined) delete process.env['SEPOLIA_RPC_URL']
	else process.env['SEPOLIA_RPC_URL'] = originalRpc
	if (originalAmmFactory === undefined) delete process.env['SEPOLIA_AMM_FACTORY_ADDRESS']
	else process.env['SEPOLIA_AMM_FACTORY_ADDRESS'] = originalAmmFactory
	if (originalV2Factory === undefined) delete process.env['MAINNET_UNISWAP_V2_FACTORY_ADDRESS']
	else process.env['MAINNET_UNISWAP_V2_FACTORY_ADDRESS'] = originalV2Factory
	if (originalV4Manager === undefined) delete process.env['SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS']
	else process.env['SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS'] = originalV4Manager
})

describe('network configuration', () => {
	test('uses a 100000 block default log scan range', () => {
		expect(runtimeConfig.logScanRangeSize).toBe(100000)
	})

	test('indexes the canonical deterministic deployments', () => {
		for (const { id, deployment, manifest } of [
			{ id: 'mainnet', deployment: mainnetDeployment, manifest: mainnetManifest },
			{ id: 'sepolia', deployment: sepoliaDeployment, manifest: sepoliaManifest },
		]) {
			const deployedById = new Map(deployment.deploymentSteps.map(({ id: deploymentId, address }) => [deploymentId, address]))
			const indexedByKind = new Map(parseManifestValue(manifest, `${id}.json`).map(([address, _label, kind]) => [kind, address]))
			expect(deployedById.get('deploymentStatusOracle')).toBe(indexedByKind.get('deploymentStatusOracle'))
			expect(deployedById.get('securityPoolFactory')).toBe(indexedByKind.get('securityPoolFactory'))
			expect(deployedById.get('securityPoolOperationsDelegate')).toBe(indexedByKind.get('securityPoolOperationsDelegate'))
			expect(indexedByKind.get('usdc')).toBeDefined()
		}
	})

	test('indexes every current deterministic contract once and no superseded addresses', () => {
		for (const { id, deployment, manifest } of [
			{ id: 'mainnet', deployment: mainnetDeployment, manifest: mainnetManifest },
			{ id: 'sepolia', deployment: sepoliaDeployment, manifest: sepoliaManifest },
		]) {
			const manifestEntries = parseManifestValue(manifest, `${id}.json`)
			const usdcAddress = id === 'mainnet' ? '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' : '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
			const expectedAddresses = new Set(
				[
					...deployment.deploymentSteps,
					...deployment.derivedContracts,
					{ address: deployment.network.genesisRepTokenAddress },
					{ address: deployment.network.wethAddress },
					{ address: usdcAddress },
				].map(({ address }) => address.toLowerCase()),
			)
			expect(new Set(manifestEntries.map(([address]) => address.toLowerCase()))).toEqual(expectedAddresses)
			expect(manifestEntries).toHaveLength(expectedAddresses.size)
			expect(new Set(manifestEntries.map(([_address, _label, kind]) => kind)).size).toBe(manifestEntries.length)
		}
	})

	test('accepts an optional exact deployment block in manifest entries', () => {
		expect(
			parseManifestValue({ contracts: [['0x1000000000000000000000000000000000000001', 'Factory', 'securityPoolFactory', '900000']] }, 'test.json'),
		).toEqual([['0x1000000000000000000000000000000000000001', 'Factory', 'securityPoolFactory', 900_000n]])
		expect(() =>
			parseManifestValue({ contracts: [['0x1000000000000000000000000000000000000001', 'Factory', 'securityPoolFactory', 900000]] }, 'test.json'),
		).toThrow('test.json contract 0 is invalid')
	})

	test('rejects duplicate manifest addresses regardless of casing or metadata', () => {
		const first = ['0x1000000000000000000000000000000000000001', 'Factory', 'securityPoolFactory']
		expect(() => parseManifestValue({ contracts: [first, [...first]] }, 'test.json')).toThrow('contract 1 duplicates address')
		expect(() =>
			parseManifestValue(
				{
					contracts: [first, ['0x1000000000000000000000000000000000000001', 'Replacement', 'openOracle']],
				},
				'test.json',
			),
		).toThrow('contract 1 duplicates address')
	})

	test('uses public endpoints with historical state by default', async () => {
		process.env['NETWORKS'] = 'mainnet,sepolia'
		delete process.env['MAINNET_RPC_URL']
		delete process.env['SEPOLIA_RPC_URL']
		const networks = await loadNetworks()

		expect(networks.map(({ rpcUrls }) => rpcUrls)).toEqual([['https://mainnet.gateway.tenderly.co'], ['https://sepolia.gateway.tenderly.co']])
	})

	test('registers canonical Uniswap activity sources and allows a default venue to be disabled', async () => {
		process.env['NETWORKS'] = 'mainnet'
		process.env['MAINNET_UNISWAP_V2_FACTORY_ADDRESS'] = ''
		const [network] = await loadNetworks()
		expect(network?.contracts.some(([, , kind]) => kind === 'uniswapV2Factory')).toBeFalse()
		expect(network?.contracts.some(([, , kind]) => kind === 'uniswapV3Factory')).toBeTrue()
		expect(network?.contracts.some(([, , kind]) => kind === 'uniswapV4PoolManager')).toBeTrue()
	})

	test('accepts a configured testnet V4 PoolManager and rejects malformed values', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS'] = '0x1000000000000000000000000000000000000004'
		expect((await loadNetworks())[0]?.contracts).toContainEqual([
			'0x1000000000000000000000000000000000000004',
			'Uniswap V4 PoolManager',
			'uniswapV4PoolManager',
		])
		process.env['SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS'] = '0x1234'
		expect(loadNetworks()).rejects.toThrow('SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS must be a complete 20-byte EVM address')
	})

	test('selects networks and preserves an exact bigint start block', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_START_BLOCK'] = '8123456'
		const networks = await loadNetworks()
		expect(networks).toHaveLength(1)
		expect(networks[0]?.chainId).toBe(11155111)
		expect(networks[0]?.nativeSymbol).toBe('SepoliaETH')
		expect(networks[0]?.startBlock).toBe(8_123_456n)
		expect(networks[0]?.contracts.length).toBeGreaterThan(10)
	})

	test('rejects a negative history boundary', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_START_BLOCK'] = '-1'
		expect(loadNetworks()).rejects.toThrow('must not be negative')
	})

	test('accepts an ordered comma-separated provider pool', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_RPC_URL'] = 'https://primary.example, https://fallback.example/rpc'
		const networks = await loadNetworks()
		expect(networks[0]?.rpcUrls).toEqual(['https://primary.example', 'https://fallback.example/rpc'])
	})

	test('optionally registers the deployed Augur AMM factory as an activity source', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_AMM_FACTORY_ADDRESS'] = '0x1000000000000000000000000000000000000001'
		const networks = await loadNetworks()
		expect(networks[0]?.contracts).toContainEqual(['0x1000000000000000000000000000000000000001', 'Augur AMM Factory', 'ammFactory'])
	})

	test('rejects a malformed Augur AMM factory address', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_AMM_FACTORY_ADDRESS'] = '0x1234'
		expect(loadNetworks()).rejects.toThrow('SEPOLIA_AMM_FACTORY_ADDRESS must be a complete 20-byte EVM address')
	})

	test('rejects non-HTTP RPC transports', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_RPC_URL'] = 'wss://provider.example'
		expect(loadNetworks()).rejects.toThrow('must contain HTTP(S) URLs')
	})

	test('rejects unknown network selections instead of silently ignoring them', async () => {
		process.env['NETWORKS'] = 'sepolia,sepollia'
		expect(loadNetworks()).rejects.toThrow('NETWORKS contains unknown network: sepollia')
	})
})

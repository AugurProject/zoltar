import { afterEach, describe, expect, test } from 'bun:test'
import path from 'node:path'
import mainnetDeployment from '../../../docs/mainnet-deployment-addresses.json'
import sepoliaDeployment from '../../../docs/sepolia-deployment-addresses.json'
import mainnetManifest from '../../config/manifests/mainnet.json'
import sepoliaManifest from '../../config/manifests/sepolia.json'
import { loadNetworks } from '../../src/config.ts'
import { parseManifestValue } from '../../src/manifest.ts'
import networkDefinitions from '../../config/networks.json'
import { getUniswapNetworkDeployment } from '@zoltar/core-shared/deployment/uniswapDeployments'
import { encodeDeployData, getAddress, mainnet, sepolia, toHex } from '@zoltar/core-shared/evm/ethereum'
import { CANONICAL_TRADING_FEE_BPS, createDeploymentStatusOracleAddressHelper, tradingDeploymentData, zoltarDeploymentStatusStepAddresses } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { DeploymentStatusOracle_DeploymentStatusOracle as statusOracleContract, trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory as factoryContract, trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter as routerContract } from '../../../solidity/ts/types/contractArtifact.ts'

const projectRoot = path.resolve(import.meta.dir, '..', '..')

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
	test('uses a 100000 block default log scan range', async () => {
		const environment = { ...process.env }
		delete environment['LOG_SCAN_RANGE_SIZE']
		const child = Bun.spawn([process.execPath, '-e', "const { runtimeConfig } = await import('./src/config.ts'); console.log(runtimeConfig.logScanRangeSize)"], {
			cwd: projectRoot,
			env: environment,
			stdout: 'pipe',
			stderr: 'pipe',
		})
		expect(await child.exited).toBe(0)
		expect(await new Response(child.stdout).text()).toBe('100000\n')
		expect(await new Response(child.stderr).text()).toBe('')
	})

	test('selected-transaction tracing defaults to disabled and accepts an explicit opt-in', async () => {
		for (const configured of [undefined, '1']) {
			const environment = { ...process.env }
			if (configured === undefined) delete environment['TRACE_SELECTED_TRANSACTIONS']
			else environment['TRACE_SELECTED_TRANSACTIONS'] = configured
			const child = Bun.spawn([process.execPath, '-e', "const { runtimeConfig } = await import('./src/config.ts'); console.log(runtimeConfig.traceSelectedTransactions)"], { cwd: projectRoot, env: environment, stdout: 'pipe', stderr: 'pipe' })
			expect(await child.exited).toBe(0)
			expect(await new Response(child.stdout).text()).toBe(`${configured === '1'}\n`)
		}
	})

	test('indexes the canonical deterministic deployments', () => {
		for (const { id, deployment, manifest } of [
			{ id: 'mainnet', deployment: mainnetDeployment, manifest: mainnetManifest },
			{ id: 'sepolia', deployment: sepoliaDeployment, manifest: sepoliaManifest },
		]) {
			const deployedById = new Map(deployment.deploymentSteps.map(({ id: deploymentId, address }) => [deploymentId, address]))
			const indexedByKind = new Map(parseManifestValue(manifest, `${id}.json`).map(([address, _label, kind]) => [kind, address]))
			expect(parseManifestValue(manifest, `${id}.json`).some(([address, , kind]) => address === deployedById.get('deploymentStatusOracle') && kind === 'deploymentStatusOracle')).toBe(true)
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
			const expectedAddresses = new Set([...deployment.deploymentSteps, ...deployment.derivedContracts, { address: deployment.network.genesisRepTokenAddress }, { address: deployment.network.wethAddress }, { address: usdcAddress }].map(({ address }) => address.toLowerCase()))
			const requiredAddress = (id: string) => {
				const entry = deployment.deploymentSteps.find(entry => entry.id === id)
				if (entry === undefined) throw new Error(`Missing deployment ${id}`)
				return getAddress(entry.address)
			}
			const trading = tradingDeploymentData(requiredAddress('proxyDeployer'), requiredAddress('securityPoolFactory'), CANONICAL_TRADING_FEE_BPS, { abi: factoryContract.abi, bytecode: `0x${factoryContract.evm.bytecode.object}` }, { abi: routerContract.abi, bytecode: `0x${routerContract.evm.bytecode.object}` })
			expectedAddresses.add(trading.factoryAddress.toLowerCase())
			expectedAddresses.add(trading.routerAddress.toLowerCase())
			expect(manifestEntries).toContainEqual([trading.factoryAddress, 'Augur AMM Factory', 'ammFactory'])
			expect(manifestEntries).toContainEqual([trading.routerAddress, 'Augur AMM Router', 'ammRouter'])
			const zoltarSteps = zoltarDeploymentStatusStepAddresses(id, getAddress(deployment.network.genesisRepTokenAddress), { proxyDeployer: requiredAddress('proxyDeployer'), multicall3: requiredAddress('multicall3'), zoltarQuestionData: requiredAddress('zoltarQuestionData'), zoltar: requiredAddress('zoltar') })
			const oracle = createDeploymentStatusOracleAddressHelper({
				deploymentStatusOracleBytecode: () => encodeDeployData({ abi: statusOracleContract.abi, bytecode: `0x${statusOracleContract.evm.bytecode.object}`, args: [zoltarSteps] }),
				proxyDeployerAddress: requiredAddress('proxyDeployer'),
				zeroSalt: toHex(0, { size: 32 }),
			}).getDeploymentStatusOracleAddress()
			expectedAddresses.add(oracle.toLowerCase())
			expect(manifestEntries).toContainEqual([oracle, 'Zoltar Deployment Status Oracle', 'deploymentStatusOracle'])
			expect(new Set(manifestEntries.map(([address]) => address.toLowerCase()))).toEqual(expectedAddresses)
			expect(manifestEntries).toHaveLength(expectedAddresses.size)
			expect(manifestEntries.filter(([, , kind]) => kind === 'deploymentStatusOracle')).toHaveLength(2)
			const otherKinds = manifestEntries.filter(([, , kind]) => kind !== 'deploymentStatusOracle').map(([, , kind]) => kind)
			expect(new Set(otherKinds).size).toBe(otherKinds.length)
		}
	})

	test('accepts an optional exact deployment block in manifest entries', () => {
		expect(parseManifestValue({ contracts: [['0x1000000000000000000000000000000000000001', 'Factory', 'securityPoolFactory', '900000']] }, 'test.json')).toEqual([['0x1000000000000000000000000000000000000001', 'Factory', 'securityPoolFactory', 900_000n]])
		expect(() => parseManifestValue({ contracts: [['0x1000000000000000000000000000000000000001', 'Factory', 'securityPoolFactory', 900000]] }, 'test.json')).toThrow('test.json contract 0 is invalid')
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

	test('registers canonical Uniswap activity sources, treats an empty override as the default, and disables a venue only on request', async () => {
		process.env['NETWORKS'] = 'mainnet'
		process.env['MAINNET_UNISWAP_V2_FACTORY_ADDRESS'] = ''
		const [network] = await loadNetworks()
		expect(network?.contracts).toContainEqual(['0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', 'Uniswap V2 Factory', 'uniswapV2Factory'])
		expect(network?.contracts.some(([, , kind]) => kind === 'uniswapV3Factory')).toBeTrue()
		expect(network?.contracts.some(([, , kind]) => kind === 'uniswapV4PoolManager')).toBeTrue()
		process.env['MAINNET_UNISWAP_V2_FACTORY_ADDRESS'] = 'none'
		expect((await loadNetworks())[0]?.contracts.some(([, , kind]) => kind === 'uniswapV2Factory')).toBeFalse()
	})

	test('indexes the published Sepolia Uniswap V4 PoolManager by default', async () => {
		process.env['NETWORKS'] = 'sepolia'
		for (const configured of [undefined, '', '  ']) {
			if (configured === undefined) delete process.env['SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS']
			else process.env['SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS'] = configured
			expect((await loadNetworks())[0]?.contracts).toContainEqual([getUniswapNetworkDeployment(11_155_111).uniswapV4PoolManagerAddress, 'Uniswap V4 PoolManager', 'uniswapV4PoolManager'])
		}
	})

	test('defaults Uniswap V3 and V4 activity sources to the shared Uniswap registry', async () => {
		const sourceEnvironmentNames = networkDefinitions.flatMap(({ uniswapV3FactoryAddressEnv, uniswapV4PoolManagerAddressEnv }) => [uniswapV3FactoryAddressEnv, uniswapV4PoolManagerAddressEnv])
		const originalSources = sourceEnvironmentNames.map(name => [name, process.env[name]] as const)
		try {
			for (const name of sourceEnvironmentNames) delete process.env[name]
			process.env['NETWORKS'] = networkDefinitions.map(({ id }) => id).join(',')
			const networks = await loadNetworks()
			expect(networks).toHaveLength(networkDefinitions.length)
			for (const network of networks) {
				const registry = getUniswapNetworkDeployment(network.chainId)
				expect(network.contracts).toContainEqual([registry.uniswapV3FactoryAddress, 'Uniswap V3 Factory', 'uniswapV3Factory'])
				expect(network.contracts).toContainEqual([registry.uniswapV4PoolManagerAddress, 'Uniswap V4 PoolManager', 'uniswapV4PoolManager'])
			}
		} finally {
			for (const [name, value] of originalSources) {
				if (value === undefined) delete process.env[name]
				else process.env[name] = value
			}
		}
	})

	test('accepts a configured testnet V4 PoolManager and rejects malformed values', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_UNISWAP_V4_POOL_MANAGER_ADDRESS'] = '0x1000000000000000000000000000000000000004'
		expect((await loadNetworks())[0]?.contracts).toContainEqual(['0x1000000000000000000000000000000000000004', 'Uniswap V4 PoolManager', 'uniswapV4PoolManager'])
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

	test('takes each block explorer from the shared chain definitions', async () => {
		process.env['NETWORKS'] = networkDefinitions.map(({ id }) => id).join(',')
		const explorers = (await loadNetworks()).map(({ chainId, explorerBaseUrl }) => [chainId, explorerBaseUrl])
		expect(explorers).toEqual([
			[mainnet.id, mainnet.blockExplorers.default.url],
			[sepolia.id, sepolia.blockExplorers.default.url],
		])
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

	test('registers the deployed Sepolia AMM factory without an environment override', async () => {
		process.env['NETWORKS'] = 'sepolia'
		for (const override of [undefined, '', '   ']) {
			if (override === undefined) delete process.env['SEPOLIA_AMM_FACTORY_ADDRESS']
			else process.env['SEPOLIA_AMM_FACTORY_ADDRESS'] = override
			const [network] = await loadNetworks()
			expect(network?.contracts.filter(([, , kind]) => kind === 'ammFactory')).toEqual([[getAddress('0xc9c6d6fc790ad1e84387528017331db041dda3a2'), 'Augur AMM Factory', 'ammFactory']])
		}
	})

	test('registers an additional AMM factory alongside the canonical activity source', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_AMM_FACTORY_ADDRESS'] = '0x1000000000000000000000000000000000000001'
		const networks = await loadNetworks()
		expect(networks[0]?.contracts).toContainEqual(['0x1000000000000000000000000000000000000001', 'Augur AMM Factory', 'ammFactory'])
		expect(networks[0]?.contracts.filter(([, , kind]) => kind === 'ammFactory')).toHaveLength(2)
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

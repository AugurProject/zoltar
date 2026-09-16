import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import example from '../../config/operator.example.json'
import { expect, test } from 'bun:test'
import { assertFocusedDeploymentCompatible, prepareDeploymentTokenTransition, validateDeploymentSettings } from '#config/deployment-settings'
import { type Address } from '@zoltar/bot-shared/ethereum'

const address = (digit: string) => `0x${digit.repeat(40)}` as Address

test('replaces the configured REP in both active and persisted live deployment settings', () => {
	const activeRep = address('1')
	const restartRep = address('2')
	const explicitToken = address('3')
	const activeTokens = [activeRep, explicitToken]

	const transition = prepareDeploymentTokenTransition(activeTokens, undefined, activeRep, restartRep)

	expect(transition.active).toEqual([restartRep, explicitToken])
	expect(transition.persisted).toEqual([restartRep, explicitToken])
})

test('rejects insecure or credential-bearing quorum RPC URLs', () => {
	const base = {
		coordinatorAddresses: [],
		deploymentManifest: undefined,
		executor: undefined,
		openOracle: address('1'),
		quorumRpcUrls: ['https://quorum.example'],
		rep: address('2'),
		uniswapFactory: address('3'),
		uniswapQuoter: address('4'),
		uniswapRouter: undefined,
		uniswapV2Router: undefined,
		uniswapV4PoolManager: undefined,
		uniswapV4Quoter: undefined,
		weth: address('5'),
	}
	expect(() => validateDeploymentSettings({ ...base, quorumRpcUrls: ['http://quorum.example'] })).toThrow('HTTPS or HTTP on loopback, anvil, or reth')
	expect(() => validateDeploymentSettings({ ...base, quorumRpcUrls: ['https://user:secret@quorum.example'] })).toThrow('embedded credentials')
})

test('rejects a focused REP update that leaves centralized-market identity stale', () => {
	const currentAsset = address('1')
	expect(() => assertFocusedDeploymentCompatible(address('2'), { assetAddress: currentAsset })).toThrow('centralized market configuration')
	expect(() => assertFocusedDeploymentCompatible(currentAsset, { assetAddress: currentAsset })).not.toThrow()
})

for (const [network, manifest] of [
	['mainnet', mainnet],
	['sepolia', sepolia],
] as const) {
	test(`always uses the ${network} CREATE2 manifest for OpenOracle`, () => {
		const expected = canonicalCoreDeployment(manifest).openOracle
		for (const openOracle of [undefined, address('0'), address('1'), 'invalid']) {
			expect(validateDeploymentSettings({ ...example.deployment, openOracle }, network).openOracle).toBe(expected)
		}
		expect(validateDeploymentSettings(example.deployment, network).openOracle).toBe(expected)
	})
}

for (const network of ['mainnet', 'sepolia'] as const) {
	test(`derives ${network} REP and WETH even when old settings supply other addresses`, () => {
		const manifest = network === 'mainnet' ? mainnet : sepolia
		const deployment = example.deployment
		for (const supplied of [deployment, { ...deployment, rep: address('0'), weth: address('1') }]) {
			const parsed = validateDeploymentSettings(supplied, network)
			expect(parsed.rep.toLowerCase()).toBe(manifest.network.genesisRepTokenAddress.toLowerCase())
			expect(parsed.weth.toLowerCase()).toBe(manifest.network.wethAddress.toLowerCase())
		}
	})
}

for (const network of ['mainnet', 'sepolia'] as const) {
	test(`derives every ${network} Uniswap address regardless of supplied address values`, () => {
		const defaults = canonicalUniswapDeployment(network === 'mainnet' ? 1 : 11155111)
		for (const supplied of [undefined, '', 'invalid', address('3'), '0x0227628f3F023bb0B980b67D528571c95c6DaC1c']) {
			const settings = validateDeploymentSettings(
				{
					coordinatorAddresses: [],
					quorumRpcUrls: [],
					uniswapV2Enabled: true,
					uniswapV3Enabled: true,
					uniswapV4Enabled: true,
					uniswapFactory: supplied,
					uniswapQuoter: supplied,
					uniswapRouter: supplied,
					uniswapV2Router: supplied,
					uniswapV4PoolManager: supplied,
					uniswapV4Quoter: supplied,
				},
				network,
			)
			expect(settings).toMatchObject({ uniswapFactory: defaults.factory, uniswapQuoter: defaults.quoter, uniswapRouter: defaults.router, uniswapV2Router: defaults.v2Router })
			expect(settings.uniswapV4PoolManager).toBeDefined()
			expect(settings.uniswapV4Quoter).toBeDefined()
		}
	})
}

test('restores all enabled venues through a serialized network round trip', () => {
	const mainnet = validateDeploymentSettings({ coordinatorAddresses: [], quorumRpcUrls: [], uniswapV2Enabled: true, uniswapV3Enabled: true, uniswapV4Enabled: true }, 'mainnet')
	const sepolia = validateDeploymentSettings(JSON.parse(JSON.stringify(mainnet)), 'sepolia')
	expect(sepolia.uniswapV2Router).toBeUndefined()
	expect(sepolia).toMatchObject({ uniswapV2Enabled: true, uniswapV3Enabled: true, uniswapV4Enabled: true })
	expect(validateDeploymentSettings(JSON.parse(JSON.stringify(sepolia)), 'mainnet')).toEqual(mainnet)
})

test('keeps disabled optional venues disabled across networks', () => {
	const original = { coordinatorAddresses: [], quorumRpcUrls: [], uniswapV2Enabled: false, uniswapV3Enabled: true, uniswapV4Enabled: false }
	const mainnet = validateDeploymentSettings(original, 'mainnet')
	const sepolia = validateDeploymentSettings(JSON.parse(JSON.stringify(mainnet)), 'sepolia')
	const restored = validateDeploymentSettings(JSON.parse(JSON.stringify(sepolia)), 'mainnet')
	for (const settings of [mainnet, sepolia, restored]) {
		expect(settings.uniswapV2Router).toBeUndefined()
		expect(settings.uniswapV4PoolManager).toBeUndefined()
		expect(settings.uniswapV4Quoter).toBeUndefined()
	}
	expect(restored).toEqual(mainnet)
})

test('rejects invalid venue switches', () => {
	for (const field of ['uniswapV2Enabled', 'uniswapV4Enabled']) {
		for (const value of ['true', 1, null]) expect(() => validateDeploymentSettings({ ...example.deployment, [field]: value })).toThrow('boolean')
	}
})

test('can disable V3 independently while keeping V4 enabled', () => {
	const settings = validateDeploymentSettings({ coordinatorAddresses: [], quorumRpcUrls: [], uniswapV2Enabled: false, uniswapV3Enabled: false, uniswapV4Enabled: true }, 'sepolia')
	expect(settings.uniswapRouter).toBeUndefined()
	expect(settings.uniswapV4PoolManager).toBeDefined()
	expect(validateDeploymentSettings(JSON.parse(JSON.stringify(settings)), 'mainnet').uniswapRouter).toBeUndefined()
})

import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import example from '../../config/operator.example.json'
import { expect, test } from 'bun:test'
import { assertFocusedDeploymentCompatible, prepareDeploymentTokenTransition, validateDeploymentSettings } from '#config/deployment-settings'
import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'

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

test('selects Sepolia Uniswap deployments when loading the mainnet example', () => {
	const parsed = validateDeploymentSettings(example.deployment, 'sepolia')
	expect(parsed.uniswapFactory).toBe('0xEf09Be426F8d6D2786cADEA7D3A8b0D09cEB79B4')
	expect(parsed.uniswapQuoter).toBe('0x6Aa53e5023fFDa81f7EEE31bdA5D35437A5DD841')
	expect(parsed.uniswapRouter).toBe('0xC0a0e58Ae39603398D474BFd49d2904dE1464C99')
	expect(parsed.uniswapV2Router).toBeUndefined()
})

test('preserves custom Uniswap deployments on either chain', () => {
	for (const network of ['mainnet', 'sepolia'] as const) {
		const overrides = { uniswapFactory: address('3'), uniswapQuoter: address('4'), uniswapRouter: address('5'), uniswapV2Router: address('6') }
		expect(validateDeploymentSettings({ ...example.deployment, uniswapDefaults: [], ...overrides }, network)).toMatchObject(overrides)
	}
})
test('restores mainnet defaults when loading a Sepolia profile and supports omitted defaults', () => {
	const sepolia = validateDeploymentSettings(example.deployment, 'sepolia')
	const mainnet = validateDeploymentSettings(sepolia, 'mainnet')
	expect(mainnet.uniswapFactory).toBe(getAddress(example.deployment.uniswapFactory))
	expect(mainnet.uniswapQuoter).toBe(getAddress(example.deployment.uniswapQuoter))
	expect(mainnet.uniswapRouter).toBe(getAddress(example.deployment.uniswapRouter))
	expect(mainnet.uniswapV2Router).toBe(getAddress(example.deployment.uniswapV2Router))
	const minimal = validateDeploymentSettings({ coordinatorAddresses: [], quorumRpcUrls: [] }, 'sepolia')
	expect(minimal.uniswapFactory).toBe(sepolia.uniswapFactory)
	expect(minimal.uniswapQuoter).toBe(sepolia.uniswapQuoter)
	expect(minimal.uniswapRouter).toBeUndefined()
	expect(minimal.uniswapV2Router).toBeUndefined()
})

test('preserves an explicitly selected upstream Sepolia deployment as a set', () => {
	const overrides = {
		uniswapFactory: getAddress('0x0227628f3F023bb0B980b67D528571c95c6DaC1c'),
		uniswapQuoter: getAddress('0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3'),
		uniswapRouter: address('5'),
	}
	const settings = validateDeploymentSettings({ coordinatorAddresses: [], quorumRpcUrls: [], ...overrides }, 'sepolia')
	expect(settings).toMatchObject(overrides)
	expect(validateDeploymentSettings(JSON.parse(JSON.stringify(settings)), 'sepolia')).toMatchObject(overrides)
})

test('preserves explicitly selected canonical addresses when changing networks', () => {
	const defaults = canonicalUniswapDeployment(1)
	const overrides = { uniswapFactory: defaults.factory, uniswapQuoter: defaults.quoter, uniswapRouter: defaults.router, uniswapV2Router: defaults.v2Router }
	expect(validateDeploymentSettings({ coordinatorAddresses: [], quorumRpcUrls: [], ...overrides }, 'sepolia')).toMatchObject(overrides)
})

for (const disabled of [undefined, null, '']) {
	test(`preserves intentionally disabled routers (${String(disabled)}) through a network round trip`, () => {
		const original = { coordinatorAddresses: [], quorumRpcUrls: [], uniswapRouter: disabled, uniswapV2Router: disabled }
		const mainnet = validateDeploymentSettings(original, 'mainnet')
		const sepolia = validateDeploymentSettings(JSON.parse(JSON.stringify(mainnet)), 'sepolia')
		const restored = validateDeploymentSettings(JSON.parse(JSON.stringify(sepolia)), 'mainnet')
		expect(restored.uniswapRouter).toBeUndefined()
		expect(restored.uniswapV2Router).toBeUndefined()
		expect(restored.uniswapFactory).toBe(mainnet.uniswapFactory)
		expect(restored.uniswapQuoter).toBe(mainnet.uniswapQuoter)
	})
}

test('can disable a default router by removing its default selection', () => {
	const sepolia = validateDeploymentSettings(example.deployment, 'sepolia')
	const disabled = { ...sepolia, uniswapDefaults: sepolia.uniswapDefaults?.filter(field => field !== 'uniswapV2Router') }
	expect(validateDeploymentSettings(disabled, 'mainnet').uniswapV2Router).toBeUndefined()
})

test('rejects invalid default selections', () => {
	for (const uniswapDefaults of ['all', null, ['uniswapV4Quoter'], [1]]) {
		expect(() => validateDeploymentSettings({ ...example.deployment, uniswapDefaults })).toThrow('Uniswap')
	}
})

test('migrates upstream Sepolia addresses only for fields explicitly using network defaults', () => {
	const settings = validateDeploymentSettings(
		{
			...example.deployment,
			uniswapFactory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
			uniswapQuoter: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',
		},
		'sepolia',
	)
	const defaults = canonicalUniswapDeployment(11155111)
	expect(settings.uniswapFactory).toBe(defaults.factory)
	expect(settings.uniswapQuoter).toBe(defaults.quoter)
	expect(settings.uniswapRouter).toBe(defaults.router)
})

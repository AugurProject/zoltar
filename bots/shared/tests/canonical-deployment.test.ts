import { expect, test } from 'bun:test'
import { canonicalCoreDeployment, canonicalNetworkDeployment, canonicalUniswapDeployment } from '../src/config/canonical-deployment.ts'

const address = '0x0000000000000000000000000000000000000001'
const manifest = {
	deploymentSteps: ['zoltar', 'multicall3', 'openOracle', 'securityPoolFactory', 'securityPoolForker'].map(id => ({ id, address })),
	derivedContracts: [{ id: 'zoltarQuestionData', address }],
	network: { wethAddress: address },
}

test('resolves core addresses from deployment steps and derived contracts', () => {
	expect(canonicalCoreDeployment(manifest)).toEqual({ zoltar: address, multicall3: address, questionData: address, openOracle: address, securityPoolFactory: address, securityPoolForker: address, weth: address })
})

test('rejects an incomplete canonical manifest', () => {
	expect(() => canonicalCoreDeployment({ ...manifest, derivedContracts: [] })).toThrow('Canonical CREATE2 manifest is missing zoltarQuestionData')
})

test('uses the manifest network identity for genesis REP and WETH', () => {
	const rep = '0x0000000000000000000000000000000000000002'
	expect(canonicalNetworkDeployment({ network: { chainId: 11_155_111, genesisRepTokenAddress: rep, wethAddress: address } })).toEqual({ chainId: 11_155_111, rep, weth: address })
})

test('uses the upstream mainnet Uniswap V4 deployment', () => {
	// https://developers.uniswap.org/docs/protocols/v4/deployments#ethereum-1
	const deployment = canonicalUniswapDeployment(1)
	expect(deployment.v4PoolManager.toLowerCase()).toBe('0x000000000004444c5dc75cb358380d2e3de08a90')
	expect(deployment.v4Quoter.toLowerCase()).toBe('0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203')
})

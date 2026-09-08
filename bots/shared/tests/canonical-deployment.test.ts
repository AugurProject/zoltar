import { expect, test } from 'bun:test'
import { canonicalCoreDeployment } from '../src/config/canonical-deployment.ts'

const address = '0x0000000000000000000000000000000000000001'
const manifest = {
	deploymentSteps: ['zoltar', 'openOracle', 'securityPoolFactory', 'securityPoolForker'].map(id => ({ id, address })),
	derivedContracts: [{ id: 'zoltarQuestionData', address }],
	network: { wethAddress: address },
}

test('resolves core addresses from deployment steps and derived contracts', () => {
	expect(canonicalCoreDeployment(manifest)).toEqual({ zoltar: address, questionData: address, openOracle: address, securityPoolFactory: address, securityPoolForker: address, weth: address })
})

test('rejects an incomplete canonical manifest', () => {
	expect(() => canonicalCoreDeployment({ ...manifest, derivedContracts: [] })).toThrow('Canonical CREATE2 manifest is missing zoltarQuestionData')
})

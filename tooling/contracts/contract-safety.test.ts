import { describe, expect, test } from 'bun:test'
import { checkContractSafety, collectDeployableContractSizes } from './contract-safety'

function storageContract(label = 'value', slot = '0', typeLabel = 'uint256') {
	return {
		abi: [],
		evm: { bytecode: { object: '6000' }, deployedBytecode: { object: '00' } },
		storageLayout: {
			storage: [{ label, offset: 0, slot, type: 't_value' }],
			types: { t_value: { encoding: 'inplace', label: typeLabel, numberOfBytes: '32' } },
		},
	}
}

test('collects production deployables and excludes test and abstract outputs', () => {
	const sizes = collectDeployableContractSizes({
		contracts: {
			'contracts/Live.sol': { Live: storageContract(), Abstract: { evm: { bytecode: { object: '' } } } },
			'contracts/test/Mock.sol': { Mock: storageContract() },
			'contracts/trading/test/TradingMock.sol': { TradingMock: storageContract() },
		},
	})
	expect(sizes).toEqual([{ sourcePath: 'contracts/Live.sol', contractName: 'Live', creationBytes: 2, initcodeBytes: 2, runtimeBytes: 1 }])
})

describe('contract safety failures', () => {
	test('reports protocol-limit and reviewed-budget regressions', () => {
		const oversized = { ...storageContract(), abi: [{ type: 'constructor', inputs: [{ type: 'address' }] }] }
		oversized.evm.deployedBytecode.object = '00'.repeat(24_577)
		oversized.evm.bytecode.object = '00'.repeat(49_121)
		const result = checkContractSafety({
			contracts: {
				'contracts/statoblast/SecurityPool.sol': { SecurityPool: oversized },
			},
		})
		expect(result.errors).toContain('contracts/statoblast/SecurityPool.sol:SecurityPool runtime is 24577 bytes; EIP-170 limit is 24576')
		expect(result.errors).toContain('contracts/statoblast/SecurityPool.sol:SecurityPool initcode is 49153 bytes; EIP-3860 limit is 49152')
		expect(result.errors.some(error => error.includes('runtime grew to 24577 bytes; reviewed budget is 24554'))).toBe(true)
	})

	test('reports missing declared delegate artifacts', () => {
		const result = checkContractSafety({ contracts: {} })
		expect(result.errors).toContain('Missing compiler output for contracts/statoblast/EscalationGame.sol')
	})
})

import { describe, expect, test } from 'bun:test'
import { contractSafetyPolicy } from './contract-safety-policy'
import { checkContractSafety, collectDeployableContractSizes, loadContractArtifact } from './contract-safety'

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
	test('reports network runtime and initcode limit violations', () => {
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
	})

	test('reports missing declared delegate artifacts', () => {
		const result = checkContractSafety({ contracts: {} })
		expect(result.errors).toContain('Missing compiler output for contracts/statoblast/EscalationGame.sol')
	})
})

test('permits production contracts to grow up to the network limits', () => {
	const artifact = loadContractArtifact('solidity/artifacts/Contracts.json')
	for (const size of collectDeployableContractSizes(artifact)) {
		const contract = artifact.contracts?.[size.sourcePath]?.[size.contractName]
		if (contract?.evm?.bytecode === undefined || contract.evm.deployedBytecode === undefined) throw new Error('Missing deployable bytecode')
		contract.evm.deployedBytecode.object = '00'.repeat(contractSafetyPolicy.runtimeLimitBytes)
		contract.evm.bytecode.object = '00'.repeat(contractSafetyPolicy.initcodeLimitBytes - (size.initcodeBytes - size.creationBytes))
	}
	expect(checkContractSafety(artifact).errors).toEqual([])
})

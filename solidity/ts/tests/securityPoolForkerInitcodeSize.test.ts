import { test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import { getContractOutput, getRecord, getString, loadContractsJson } from './contractArtifactHelpers'

const eip3860InitcodeLimitBytes = 49_152
const eip170RuntimeCodeLimitBytes = 24_576
const securityPoolForkerConstructorArgumentBytes = 32

function getBytecodeBytes(kind: 'bytecode' | 'deployedBytecode') {
	const artifacts = loadContractsJson(import.meta.dir)
	const output = getContractOutput(artifacts, 'contracts/peripherals/SecurityPoolForker.sol', 'SecurityPoolForker')
	const evm = getRecord(output.evm, 'SecurityPoolForker output is missing EVM bytecode')
	const bytecode = getRecord(evm[kind], `SecurityPoolForker output is missing ${kind}`)
	return getString(bytecode.object, `SecurityPoolForker ${kind} is missing`).length / 2
}

test('SecurityPoolForker initcode stays within the EIP-3860 limit', () => {
	const creationBytecodeBytes = getBytecodeBytes('bytecode')
	const initcodeBytes = creationBytecodeBytes + securityPoolForkerConstructorArgumentBytes

	assert.ok(initcodeBytes <= eip3860InitcodeLimitBytes, `SecurityPoolForker initcode exceeds EIP-3860: ${initcodeBytes} bytes (limit ${eip3860InitcodeLimitBytes})`)
})

test('SecurityPoolForker runtime stays within the EIP-170 limit', () => {
	const runtimeBytecodeBytes = getBytecodeBytes('deployedBytecode')

	assert.ok(runtimeBytecodeBytes <= eip170RuntimeCodeLimitBytes, `SecurityPoolForker runtime exceeds EIP-170: ${runtimeBytecodeBytes} bytes (limit ${eip170RuntimeCodeLimitBytes})`)
})

import { test } from 'bun:test'
import assert from '../testsuite/simulator/utils/assert'
import { getContractOutput, getRecord, getString, loadContractsJson } from './contractArtifactHelpers'

const eip3860InitcodeLimitBytes = 49_152
const securityPoolForkerConstructorArgumentBytes = 32

function getCreationBytecodeBytes() {
	const artifacts = loadContractsJson(import.meta.dir)
	const output = getContractOutput(artifacts, 'contracts/peripherals/SecurityPoolForker.sol', 'SecurityPoolForker')
	const evm = getRecord(output.evm, 'SecurityPoolForker output is missing EVM bytecode')
	const bytecode = getRecord(evm.bytecode, 'SecurityPoolForker output is missing creation bytecode')
	return getString(bytecode.object, 'SecurityPoolForker creation bytecode is missing').length / 2
}

test('SecurityPoolForker initcode stays within the EIP-3860 limit', () => {
	const creationBytecodeBytes = getCreationBytecodeBytes()
	const initcodeBytes = creationBytecodeBytes + securityPoolForkerConstructorArgumentBytes

	assert.ok(initcodeBytes <= eip3860InitcodeLimitBytes, `SecurityPoolForker initcode exceeds EIP-3860: ${initcodeBytes} bytes (limit ${eip3860InitcodeLimitBytes})`)
})

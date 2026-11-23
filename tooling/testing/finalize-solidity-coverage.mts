import { afterAll } from 'bun:test'
import { join } from 'node:path'
import { getSolidityBytecodeCoverageConfig } from '../../solidity/ts/testSupport/coverage/coverageConfig'
import { flushSolidityBytecodeCoverageForTest } from '../../solidity/ts/testSupport/coverage/traceToSource'

process.env['SOLIDITY_BYTECODE_COVERAGE_FINALIZE'] = '1'

afterAll(async () => {
	const config = getSolidityBytecodeCoverageConfig()
	await flushSolidityBytecodeCoverageForTest()
	await Bun.write(join(config.coverageDirectory, 'complete'), '')
})

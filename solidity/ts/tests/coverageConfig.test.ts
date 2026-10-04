import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSolidityBytecodeCoverageConfig } from '../testSupport/coverage/coverageConfig'

test('resolves repository coverage paths from inside the Solidity package', async () => {
	const root = await mkdtemp(join(tmpdir(), 'coverage-config-'))
	const previousDirectory = process.cwd()
	const previousRoot = process.env['SOLIDITY_BYTECODE_COVERAGE_ROOT_PATH']
	try {
		await mkdir(join(root, 'solidity', 'artifacts'), { recursive: true })
		await writeFile(join(root, 'solidity', 'artifacts', 'Contracts.json'), '{}')
		delete process.env['SOLIDITY_BYTECODE_COVERAGE_ROOT_PATH']
		process.chdir(join(root, 'solidity'))
		expect(getSolidityBytecodeCoverageConfig().rootPath).toBe(root)
		expect(getSolidityBytecodeCoverageConfig().artifactsPath).toBe(join(root, 'solidity', 'artifacts', 'Contracts.json'))
	} finally {
		process.chdir(previousDirectory)
		if (previousRoot === undefined) delete process.env['SOLIDITY_BYTECODE_COVERAGE_ROOT_PATH']
		else process.env['SOLIDITY_BYTECODE_COVERAGE_ROOT_PATH'] = previousRoot
		await rm(root, { recursive: true, force: true })
	}
})

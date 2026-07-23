import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { discoverTestFiles } from './test-discovery.mts'

const repositoryRoot = process.cwd()
const coverageDirectory = join(repositoryRoot, 'coverage', 'typescript')
const startedAt = Date.now()

await rm(coverageDirectory, { recursive: true, force: true })
await mkdir(coverageDirectory, { recursive: true })

const testFiles = await discoverTestFiles(repositoryRoot)
const child = Bun.spawn({
	cmd: [process.execPath, './scripts/run-tests.mts', '--bail=1', '--coverage', '--coverage-reporter=lcov', '--coverage-reporter=text', '--coverage-dir=coverage/typescript', '--reporter=dots'],
	env: process.env,
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
})
const exitCode = await child.exited
if (exitCode !== 0) process.exit(exitCode)

await writeFile(
	join(coverageDirectory, 'test-files.json'),
	`${JSON.stringify(
		{
			status: 'passed',
			count: testFiles.length,
			durationMs: Date.now() - startedAt,
			files: testFiles,
		},
		undefined,
		2,
	)}\n`,
)

import { expect, test } from 'bun:test'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBunTestProcess } from './run-bun-test-process.mts'

const repositoryRoot = join(import.meta.dir, '..')

test('test entrypoints protect Bun isolate workers from piped Linux stdio', async () => {
	for (const relativePath of ['scripts/run-tests.mts', 'scripts/run-balanced-test-shard.mts', 'scripts/run-solidity-bytecode-coverage.mts']) {
		const source = await readFile(join(repositoryRoot, relativePath), 'utf8')
		expect(source).toContain("from './run-bun-test-process.mts'")
		expect(source).toContain('runBunTestProcess(')
	}
})

test('Linux test process output uses regular files and is forwarded with the exit code', async () => {
	const outputDirectory = mkdtempSync(join(tmpdir(), 'zoltar-bun-test-process-'))
	const stdoutPath = join(outputDirectory, 'stdout.log')
	const stderrPath = join(outputDirectory, 'stderr.log')
	const stdoutTargetFd = openSync(stdoutPath, 'w')
	const stderrTargetFd = openSync(stderrPath, 'w')

	try {
		let exitCode: number
		try {
			exitCode = await runBunTestProcess({
				cmd: [process.execPath, '-e', "import { fstatSync } from 'node:fs'; console.log(JSON.stringify({ stdoutIsFile: fstatSync(1).isFile(), stderrIsFile: fstatSync(2).isFile() })); console.error('stderr marker'); process.exit(7)"],
				redirectStdio: true,
				stderrTargetFd,
				stdoutTargetFd,
			})
		} finally {
			closeSync(stderrTargetFd)
			closeSync(stdoutTargetFd)
		}

		expect(exitCode).toBe(7)
		expect(readFileSync(stdoutPath, 'utf8')).toContain('{"stdoutIsFile":true,"stderrIsFile":true}')
		expect(readFileSync(stderrPath, 'utf8')).toContain('stderr marker')
	} finally {
		rmSync(outputDirectory, { force: true, recursive: true })
	}
})

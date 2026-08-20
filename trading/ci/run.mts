import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const repositoryRoot = path.resolve(projectRoot, '..')

const steps = [
	{ command: ['bun', 'install', '--frozen-lockfile'], cwd: projectRoot },
	{ command: ['bun', 'run', 'ensure-contract-artifacts'], cwd: repositoryRoot },
	{ command: ['bun', 'run', 'refresh:shared-dependencies'], cwd: repositoryRoot },
	{ command: ['bun', 'run', 'compile'], cwd: projectRoot },
	{ command: ['bun', 'run', 'refresh:shared-dependencies'], cwd: repositoryRoot },
	{ command: ['bun', 'run', 'tsc'], cwd: projectRoot },
	{ command: ['bun', 'test', '--isolate', './ts/tests', '../ui/trading/ts/tests'], cwd: projectRoot },
	{ command: ['bun', './scripts/run-solidity-coverage.mts'], cwd: projectRoot },
	{ command: ['bun', 'run', 'format:check'], cwd: projectRoot },
	{ command: ['bun', 'run', 'trading:ui:build'], cwd: repositoryRoot },
	// The vulnerable nanoid is tooling-only through tevm's Vitest chain; keep all other advisories blocking until the package can refresh that upstream lock entry.
	{ command: ['bun', 'audit', '--ignore', 'GHSA-2v37-7h3g-55p8'], cwd: projectRoot },
] as const

for (const { command, cwd } of steps) {
	console.log(`trading-ci: ${command.join(' ')}`)
	const child = Bun.spawn({ cmd: [...command], cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
	const exitCode = await child.exited
	if (exitCode !== 0) process.exit(exitCode)
}

console.log('trading-ci: all checks passed')

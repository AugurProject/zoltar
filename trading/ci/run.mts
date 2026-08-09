import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const repositoryRoot = path.resolve(projectRoot, '..')

const steps = [
	{ command: ['bun', 'install', '--frozen-lockfile'], cwd: projectRoot },
	{ command: ['bun', 'run', 'ensure-shared-build'], cwd: repositoryRoot },
	{ command: ['bun', 'run', 'refresh:shared-dependencies'], cwd: repositoryRoot },
	{ command: ['bun', 'run', 'compile'], cwd: projectRoot },
	{ command: ['bun', 'run', 'refresh:shared-dependencies'], cwd: repositoryRoot },
	{ command: ['bun', 'run', 'tsc'], cwd: projectRoot },
	{ command: ['bun', 'test', './ts/tests', './ui/ts/tests'], cwd: projectRoot },
	{ command: ['bun', 'run', 'format:check'], cwd: projectRoot },
	{ command: ['bun', 'run', 'ui:build'], cwd: projectRoot },
	{ command: ['bun', 'audit'], cwd: projectRoot },
] as const

for (const { command, cwd } of steps) {
	console.log(`trading-ci: ${command.join(' ')}`)
	const child = Bun.spawn({ cmd: [...command], cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
	const exitCode = await child.exited
	if (exitCode !== 0) process.exit(exitCode)
}

console.log('trading-ci: all checks passed')

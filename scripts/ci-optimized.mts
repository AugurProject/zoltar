import { spawn, spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

type CommandStep = {
	name: string
	command: string
	args: string[]
	cwd?: string | undefined
	env?: NodeJS.ProcessEnv | undefined
}

type ParallelTask = {
	name: string
	run: () => Promise<void>
}

const scriptDirectory = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRoot = path.join(scriptDirectory, '..')
const bunCommand = process.execPath
const defaultTestShardCount = 4
const defaultTestParallelism = availableParallelism() >= 8 ? 2 : 1
const skipWorktreeCheck = process.env['ZOLTAR_CI_SKIP_WORKTREE_CHECK'] === '1'

function formatDuration(milliseconds: number) {
	const seconds = milliseconds / 1000
	return `${seconds.toFixed(1)}s`
}

function readPositiveIntegerEnv(name: string, fallback: number) {
	const rawValue = process.env[name]
	if (rawValue === undefined) return fallback
	if (!/^[1-9]\d*$/.test(rawValue)) throw new Error(`${name} must be a positive integer`)
	const value = Number(rawValue)
	if (Number.isSafeInteger(value)) return value
	throw new Error(`${name} must be a positive integer`)
}

const testShardCount = readPositiveIntegerEnv('ZOLTAR_CI_TEST_SHARDS', defaultTestShardCount)
const testParallelism = readPositiveIntegerEnv('ZOLTAR_CI_TEST_PARALLEL', defaultTestParallelism)

async function runStep({ args, command, cwd = repositoryRoot, env = process.env, name }: CommandStep) {
	const startedAt = Date.now()
	console.log(`\n==> ${name}`)
	console.log(`$ ${[command, ...args].join(' ')}`)
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env,
			stdio: 'inherit',
		})
		child.on('error', reject)
		child.on('exit', code => {
			const elapsed = formatDuration(Date.now() - startedAt)
			if (code === 0) {
				console.log(`PASS ${name} passed in ${elapsed}`)
				resolve()
				return
			}
			reject(new Error(`${name} failed with exit code ${code ?? 'unknown'} after ${elapsed}`))
		})
	})
}

async function runBunScript(name: string, script: string, env?: NodeJS.ProcessEnv) {
	await runStep({
		args: ['run', script],
		command: bunCommand,
		env,
		name,
	})
}

function runGitStatus(args: readonly string[]) {
	const result = spawnSync('git', args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
	})
	if (result.error !== undefined) throw result.error
	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed.\n${result.stdout}${result.stderr}`)
	}
	return result.stdout
}

function assertCleanWorktreeStatus(name: string) {
	const startedAt = Date.now()
	console.log(`\n==> ${name}`)
	console.log('$ git status --porcelain --untracked-files=normal')
	const status = runGitStatus(['status', '--porcelain', '--untracked-files=normal'])
	if (status.trim() === '') {
		console.log(`PASS ${name} passed in ${formatDuration(Date.now() - startedAt)}`)
		return
	}
	throw new Error(`CI left staged, tracked, or untracked worktree status. Commit intended changes, fix generated output churn, or update .gitignore as appropriate.\n${status}`)
}

async function runWorktreeCleanlinessChecks(stage: string) {
	if (skipWorktreeCheck) {
		console.log(`\nSkipping ${stage.toLowerCase()} worktree cleanliness checks because ZOLTAR_CI_SKIP_WORKTREE_CHECK=1.`)
		return
	}

	await runStep({
		args: ['diff', '--exit-code', '--', '.'],
		command: 'git',
		name: `${stage} tracked diff check`,
	})
	assertCleanWorktreeStatus(`${stage} worktree status check`)
	await runStep({
		args: ['diff', '--check'],
		command: 'git',
		name: `${stage} whitespace diff check`,
	})
}

async function runAuditGroup() {
	await runStep({
		args: ['audit'],
		command: bunCommand,
		name: 'Dependency audit: root',
	})
	await runStep({
		args: ['audit'],
		command: bunCommand,
		cwd: path.join(repositoryRoot, 'ui'),
		name: 'Dependency audit: ui',
	})
	await runStep({
		args: ['audit'],
		command: bunCommand,
		cwd: path.join(repositoryRoot, 'solidity'),
		name: 'Dependency audit: solidity',
	})
}

async function runTests() {
	if (testShardCount === 1) {
		await runStep({
			args: ['run', 'test:run:shard', '--', `--parallel=${testParallelism}`],
			command: bunCommand,
			env: productionBuildTestEnv,
			name: 'Tests',
		})
		return
	}

	await runParallel(
		Array.from({ length: testShardCount }, (_value, index) => {
			const shardNumber = index + 1
			return {
				name: `Tests shard ${shardNumber}/${testShardCount}`,
				run: async () =>
					await runStep({
						args: ['run', 'test:run:shard', '--', `--parallel=${testParallelism}`, `--shard=${shardNumber}/${testShardCount}`],
						command: bunCommand,
						env: productionBuildTestEnv,
						name: `Tests shard ${shardNumber}/${testShardCount}`,
					}),
			}
		}),
	)
}

async function runParallel(tasks: readonly ParallelTask[]) {
	const results = await Promise.allSettled(
		tasks.map(async task => {
			const startedAt = Date.now()
			console.log(`\n==> Starting parallel task: ${task.name}`)
			await task.run()
			console.log(`PASS Parallel task ${task.name} passed in ${formatDuration(Date.now() - startedAt)}`)
		}),
	)
	const failures: unknown[] = []
	for (const result of results) {
		if (result.status === 'rejected') failures.push(result.reason)
	}
	if (failures.length === 0) return

	for (const failure of failures) {
		console.error(failure)
	}
	throw new Error(`${failures.length} parallel CI task(s) failed`)
}

const productionBuildTestEnv = {
	...process.env,
	ZOLTAR_USE_EXISTING_PRODUCTION_BUILD: '1',
}

await runBunScript('Generate and verify untracked artifacts', 'check:generated-artifacts')
await runBunScript('Format', 'format')
await runWorktreeCleanlinessChecks('Pre-task')
await runBunScript('TypeScript type checking', 'tsc')
await runBunScript('Production UI build and mainnet deployment validation', 'ui:build:prod:optimized')

let parallelTaskFailure: unknown
try {
	await runParallel([
		{
			name: 'Tests',
			run: runTests,
		},
		{
			name: 'Biome and Solidity checks',
			run: async () => await runBunScript('Biome and Solidity checks', 'check'),
		},
		{
			name: 'Dead code analysis',
			run: async () => await runBunScript('Dead code analysis', 'knip'),
		},
		{
			name: 'Dependency audit',
			run: runAuditGroup,
		},
	])
} catch (error) {
	parallelTaskFailure = error
} finally {
	try {
		await runWorktreeCleanlinessChecks('Final')
	} catch (error) {
		if (parallelTaskFailure === undefined) throw error
		console.error('Final worktree cleanliness checks failed after an earlier CI task failure:')
		console.error(error)
	}
}

if (parallelTaskFailure !== undefined) throw parallelTaskFailure

console.log('\nOptimized CI gate passed.')

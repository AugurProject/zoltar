import { availableParallelism } from 'node:os'
import { cleanupFoundryAnvilState } from './cleanup-foundry-anvil-state.mts'
import { runBunTestProcess } from './run-bun-test-process.mts'
import { discoverTestFiles, getDefaultTestParallelism, hasExplicitTestPath, toBunTestPath } from './test-discovery.mts'

const defaultParallelism = getDefaultTestParallelism(availableParallelism())
const cleanupStaleAnvilState = async (phase: 'before' | 'after') => {
	try {
		const result = await cleanupFoundryAnvilState()
		if (result.deletedCount > 0) console.warn(`Deleted ${result.deletedCount} stale Anvil state director${result.deletedCount === 1 ? 'y' : 'ies'} ${phase} tests`)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.warn(`Failed to clean stale Anvil state directories ${phase} tests: ${message}`)
	}
}

const normalizeOptionValueArgs = (args: string[]) => {
	const normalizedArgs: string[] = []
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === undefined) continue
		const nextArg = args[index + 1]
		if (((arg === '--parallel' && /^\d+$/.test(nextArg ?? '')) || arg === '--timeout') && nextArg !== undefined && !nextArg.startsWith('--')) {
			normalizedArgs.push(`${arg}=${nextArg}`)
			index += 1
			continue
		}
		normalizedArgs.push(arg)
	}
	return normalizedArgs
}
const passthroughArgs = normalizeOptionValueArgs(process.argv.slice(2))
const hasArg = (name: string) => passthroughArgs.some(arg => arg === name || arg.startsWith(`${name}=`))
const args = ['test', '--preload', './bun-test-setup-ui.ts']

if (!hasArg('--parallel')) args.push(`--parallel=${defaultParallelism}`)
if (!hasArg('--timeout')) args.push('--timeout', '300000')

args.push(...passthroughArgs)
if (!hasExplicitTestPath(passthroughArgs)) args.push(...(await discoverTestFiles()).map(toBunTestPath))

await cleanupStaleAnvilState('before')

let exitCode = 1
try {
	if (process.env['ZOLTAR_USE_EXISTING_PRODUCTION_BUILD'] !== '1') {
		// Build shared production assets before parallel tests so productionBuild.test.ts
		// does not clear and regenerate ui/<app>/vendor while sharedAssets.test.ts traverses it.
		const productionBuild = Bun.spawn({
			cmd: [process.execPath, 'run', 'ui:build:prod'],
			stderr: 'inherit',
			stdin: 'inherit',
			stdout: 'inherit',
		})
		exitCode = await productionBuild.exited
		if (exitCode !== 0) process.exitCode = exitCode
		else
			exitCode = await runBunTestProcess({
				cmd: [process.execPath, ...args],
				env: { ...process.env, ZOLTAR_USE_EXISTING_PRODUCTION_BUILD: '1' },
			})
	} else {
		exitCode = await runBunTestProcess({
			cmd: [process.execPath, ...args],
			env: { ...process.env, ZOLTAR_USE_EXISTING_PRODUCTION_BUILD: '1' },
		})
	}
	process.exitCode = exitCode
} finally {
	await cleanupStaleAnvilState('after')
}

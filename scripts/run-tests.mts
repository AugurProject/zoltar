import { availableParallelism } from 'node:os'
import { cleanupFoundryAnvilState } from './cleanup-foundry-anvil-state.mts'

const maximumParallelism = 12
const defaultParallelism = Math.max(1, Math.min(maximumParallelism, availableParallelism()))
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
		if ((arg === '--parallel' || arg === '--timeout') && nextArg !== undefined && !nextArg.startsWith('--')) {
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

await cleanupStaleAnvilState('before')

const child = Bun.spawn({
	cmd: [process.execPath, ...args],
	stderr: 'inherit',
	stdin: 'inherit',
	stdout: 'inherit',
})
const exitCode = await child.exited
await cleanupStaleAnvilState('after')
process.exit(exitCode)

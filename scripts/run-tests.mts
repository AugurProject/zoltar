import { availableParallelism } from 'node:os'

const maximumParallelism = 12
const defaultParallelism = Math.max(1, Math.min(maximumParallelism, availableParallelism()))
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

const child = Bun.spawn({
	cmd: [process.execPath, ...args],
	stderr: 'inherit',
	stdin: 'inherit',
	stdout: 'inherit',
})
const exitCode = await child.exited
process.exit(exitCode)

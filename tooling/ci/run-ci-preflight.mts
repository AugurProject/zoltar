import * as process from 'node:process'

export function getCiPreflightTasks(args: readonly string[]) {
	if (args.length > 1 || args.some(argument => argument !== '--typecheck-only')) throw new Error('Expected no arguments or --typecheck-only')
	// UI builds typecheck their own projects while emitting the dependencies needed by the production bundle.
	const tasks = [
		{ command: ['run', 'tsc:scripts'], name: 'Script TypeScript' },
		{ command: ['run', 'tsc:solidity:current'], name: 'Solidity TypeScript' },
	]
	if (!args.includes('--typecheck-only')) tasks.push({ command: ['run', 'ui:build:prod:current'], name: 'Production UI build' })
	return tasks
}

async function runCiPreflight(args: readonly string[]) {
	const results = await Promise.all(
		getCiPreflightTasks(args).map(async task => {
			console.log(`Starting ${task.name}: bun ${task.command.join(' ')}`)
			const child = Bun.spawn({
				cmd: [process.execPath, ...task.command],
				stderr: 'inherit',
				stdin: 'inherit',
				stdout: 'inherit',
			})
			const exitCode = await child.exited
			return { exitCode, name: task.name }
		}),
	)

	const failures = results.filter(result => result.exitCode !== 0)
	for (const result of results) console.log(`${result.exitCode === 0 ? 'PASS' : 'FAIL'} ${result.name}`)
	if (failures.length > 0) throw new Error(`CI preflight failed: ${failures.map(failure => `${failure.name} (exit ${failure.exitCode.toString()})`).join(', ')}`)
}

if (import.meta.main) await runCiPreflight(process.argv.slice(2))

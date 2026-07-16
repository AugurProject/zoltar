import * as process from 'node:process'

const existingNodeOptions = process.env['NODE_OPTIONS']
const applicationTypeScriptNodeOptions = existingNodeOptions === undefined || existingNodeOptions === '' ? '--max-old-space-size=6144' : `${existingNodeOptions} --max-old-space-size=6144`

const tasks = [
	{ command: ['run', 'tsc:app'], name: 'Application TypeScript', nodeOptions: applicationTypeScriptNodeOptions },
	{ command: ['run', 'tsc:scripts'], name: 'Script TypeScript', nodeOptions: undefined },
	{ command: ['run', 'tsc:solidity:current'], name: 'Solidity TypeScript', nodeOptions: undefined },
	{ command: ['run', 'ui:build:prod:current'], name: 'Production UI build', nodeOptions: undefined },
] as const

const results = await Promise.all(
	tasks.map(async task => {
		console.log(`Starting ${task.name}: bun ${task.command.join(' ')}`)
		const child = Bun.spawn({
			cmd: [process.execPath, ...task.command],
			...(task.nodeOptions === undefined ? {} : { env: { ...process.env, NODE_OPTIONS: task.nodeOptions } }),
			stderr: 'inherit',
			stdin: 'inherit',
			stdout: 'inherit',
		})
		const exitCode = await child.exited
		return { exitCode, name: task.name }
	}),
)

const failures = results.filter(result => result.exitCode !== 0)
for (const result of results) {
	console.log(`${result.exitCode === 0 ? 'PASS' : 'FAIL'} ${result.name}`)
}

if (failures.length > 0) {
	throw new Error(`CI preflight failed: ${failures.map(failure => `${failure.name} (exit ${failure.exitCode.toString()})`).join(', ')}`)
}

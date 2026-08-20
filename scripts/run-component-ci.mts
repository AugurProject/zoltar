import path from 'node:path'

const packageName = process.argv[2]
const repositoryRoot = path.resolve(import.meta.dir, '..')

const definitions: Readonly<Record<string, { readonly directory: string; readonly commands: readonly (readonly string[])[] }>> = {
	trading: { directory: 'trading', commands: [['bun', 'run', 'ci']] },
	'bot-shared': {
		directory: 'bots/shared',
		commands: [
			['bun', 'run', 'check'],
			['bun', 'audit'],
		],
	},
	arbitrager: {
		directory: 'bots/open-oracle-arbitrager',
		commands: [
			['bun', 'run', 'check'],
			['bun', 'audit'],
		],
	},
	liquidator: {
		directory: 'bots/liquidator',
		commands: [
			['bun', 'run', 'check'],
			['bun', 'audit'],
		],
	},
	'augur-scan': {
		directory: 'augurScan',
		commands: [
			['bun', 'run', 'typecheck'],
			['bun', 'run', 'check'],
			['bun', 'run', 'test'],
			['bun', 'audit'],
		],
	},
}

if (packageName === undefined || definitions[packageName] === undefined) throw new Error(`Unknown component package: ${packageName ?? '(missing)'}`)
const definition = definitions[packageName]
const cwd = path.join(repositoryRoot, definition.directory)
for (const command of definition.commands) {
	console.log(`component-ci(${packageName}): ${command.join(' ')}`)
	const child = Bun.spawn({ cmd: [...command], cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
	const exitCode = await child.exited
	if (exitCode !== 0) process.exit(exitCode)
}

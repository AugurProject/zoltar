import path from 'node:path'

const packageName = process.argv[2]
const repositoryRoot = path.resolve(import.meta.dir, '..')
const botAudit = ['bun', 'audit', '--ignore', 'GHSA-8xcm-r25x-g524', '--ignore', 'GHSA-4cwx-7wf7-3272', '--ignore', 'GHSA-m8rv-5g2x-5cg5', '--ignore', 'GHSA-jr45-8vmc-qm54', '--ignore', 'GHSA-v3r7-h72x-cjcm'] as const
const augurScanAudit = ['bun', 'audit', '--ignore', 'GHSA-52f5-9888-hmc6', '--ignore', 'GHSA-ph9p-34f9-6g65'] as const

const definitions: Readonly<Record<string, { readonly directory: string; readonly commands: readonly (readonly string[])[] }>> = {
	trading: { directory: 'trading', commands: [['bun', 'run', 'ci']] },
	'bot-shared': {
		directory: 'bots/shared',
		commands: [['bun', 'run', 'check'], botAudit],
	},
	arbitrager: {
		directory: 'bots/open-oracle-arbitrager',
		commands: [['bun', 'run', 'check'], botAudit],
	},
	liquidator: {
		directory: 'bots/liquidator',
		commands: [['bun', 'run', 'check'], botAudit],
	},
	'augur-scan': {
		directory: 'augurScan',
		commands: [['bun', 'run', 'typecheck'], ['bun', 'run', 'check'], ['bun', 'run', 'test'], augurScanAudit],
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

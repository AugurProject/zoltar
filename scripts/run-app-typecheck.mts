import * as process from 'node:process'

const APPLICATION_TYPESCRIPT_HEAP_LIMIT_MB = 6_144

export function applicationTypeScriptNodeOptions(existingNodeOptions: string | undefined) {
	const heapLimitOption = `--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_LIMIT_MB.toString()}`
	return existingNodeOptions === undefined || existingNodeOptions === '' ? heapLimitOption : `${existingNodeOptions} ${heapLimitOption}`
}

export async function runApplicationTypeScript() {
	const child = Bun.spawn({
		cmd: [process.execPath, 'x', 'tsc', '--noEmit'],
		env: {
			...process.env,
			NODE_OPTIONS: applicationTypeScriptNodeOptions(process.env['NODE_OPTIONS']),
		},
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit',
	})
	return await child.exited
}

if (import.meta.main) {
	const exitCode = await runApplicationTypeScript()
	if (exitCode !== 0) process.exit(exitCode)
}

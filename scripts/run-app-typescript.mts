import * as process from 'node:process'

export const APPLICATION_TYPESCRIPT_HEAP_MB = 6144

export function getApplicationTypeScriptNodeOptions(existingNodeOptions: string | undefined) {
	const normalizedNodeOptions = existingNodeOptions?.trim()
	if (normalizedNodeOptions !== undefined && /--max[-_]old[-_]space[-_]size(?:=|\s)/.test(normalizedNodeOptions)) return normalizedNodeOptions
	const heapOption = `--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`
	return normalizedNodeOptions === undefined || normalizedNodeOptions === '' ? heapOption : `${normalizedNodeOptions} ${heapOption}`
}

if (import.meta.main) {
	const child = Bun.spawn({
		cmd: [process.execPath, 'x', 'tsc', '--noEmit'],
		env: { ...process.env, NODE_OPTIONS: getApplicationTypeScriptNodeOptions(process.env['NODE_OPTIONS']) },
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit',
	})
	const exitCode = await child.exited
	if (exitCode !== 0) process.exit(exitCode)
}

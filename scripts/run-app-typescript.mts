import * as process from 'node:process'
import { fileURLToPath } from 'node:url'

export const APPLICATION_TYPESCRIPT_HEAP_MB = 6144
const TYPESCRIPT_CLI_PATH = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
const EXPLICIT_HEAP_LIMIT_PATTERN = /(?:^|\s)--max[-_]old[-_]space[-_]size(?:=|\s+)([0-9]+)(?=\s|$)/

export function getApplicationTypeScriptHeapOption(existingNodeOptions: string | undefined) {
	const explicitHeapLimitMb = existingNodeOptions === undefined ? undefined : EXPLICIT_HEAP_LIMIT_PATTERN.exec(existingNodeOptions)?.[1]
	return `--max-old-space-size=${explicitHeapLimitMb ?? APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`
}

export const getApplicationTypeScriptCommand = (nodeExecutablePath: string, typescriptCliPath: string, existingNodeOptions: string | undefined) => [nodeExecutablePath, getApplicationTypeScriptHeapOption(existingNodeOptions), typescriptCliPath, '--noEmit']

export async function runApplicationTypeScript() {
	const nodeExecutablePath = Bun.which('node')
	if (nodeExecutablePath === null) throw new Error('Node.js is required to run the application TypeScript check with its configured heap limit.')

	const child = Bun.spawn({
		cmd: getApplicationTypeScriptCommand(nodeExecutablePath, TYPESCRIPT_CLI_PATH, process.env['NODE_OPTIONS']),
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

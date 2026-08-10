import * as process from 'node:process'
import { fileURLToPath } from 'node:url'

const APPLICATION_TYPESCRIPT_HEAP_LIMIT_MB = 6_144
const TYPESCRIPT_CLI_PATH = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

export const applicationTypeScriptCommand = (nodeExecutablePath: string, typescriptCliPath: string) => [nodeExecutablePath, `--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_LIMIT_MB.toString()}`, typescriptCliPath, '--noEmit']

export async function runApplicationTypeScript() {
	const nodeExecutablePath = Bun.which('node')
	if (nodeExecutablePath === null) throw new Error('Node.js is required to run the application TypeScript check with its configured heap limit.')

	const child = Bun.spawn({
		cmd: applicationTypeScriptCommand(nodeExecutablePath, TYPESCRIPT_CLI_PATH),
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

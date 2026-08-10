import * as process from 'node:process'
import { fileURLToPath } from 'node:url'

export const APPLICATION_TYPESCRIPT_HEAP_MB = 6144
const TYPESCRIPT_CLI_PATH = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
const EXPLICIT_HEAP_LIMIT_PATTERN = /^--max[-_]old[-_]space[-_]size(?:=([0-9]+))?$/

const tokenizeNodeOptions = (nodeOptions: string): string[] => {
	const tokens: string[] = []
	let token = ''
	let quote: '"' | "'" | undefined
	for (const character of nodeOptions) {
		if (quote !== undefined) {
			if (character === quote) quote = undefined
			else token += character
			continue
		}
		if (character === '"' || character === "'") quote = character
		else if (/\s/.test(character)) {
			if (token !== '') {
				tokens.push(token)
				token = ''
			}
		} else token += character
	}
	if (token !== '') tokens.push(token)
	return tokens
}

const getExplicitHeapLimitMb = (nodeOptions: string | undefined): string | undefined => {
	if (nodeOptions === undefined) return undefined
	const tokens = tokenizeNodeOptions(nodeOptions)
	let explicitHeapLimitMb: string | undefined
	for (let index = 0; index < tokens.length; index += 1) {
		const match = EXPLICIT_HEAP_LIMIT_PATTERN.exec(tokens[index] ?? '')
		if (match === null) continue
		const inlineValue = match[1]
		if (inlineValue !== undefined) explicitHeapLimitMb = inlineValue
		else if (/^[0-9]+$/.test(tokens[index + 1] ?? '')) {
			explicitHeapLimitMb = tokens[index + 1]
			index += 1
		}
	}
	return explicitHeapLimitMb
}

export function getApplicationTypeScriptHeapOption(existingNodeOptions: string | undefined) {
	const explicitHeapLimitMb = getExplicitHeapLimitMb(existingNodeOptions)
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

import * as process from 'node:process'
import { fileURLToPath } from 'node:url'

export const APPLICATION_TYPESCRIPT_HEAP_MB = 6144
const TYPESCRIPT_CLI_PATH = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
const EXPLICIT_HEAP_LIMIT_PATTERN = /^--max[-_]old[-_]space[-_]size=([+]?[0-9]+)$/

type NodeOptionToken = {
	readonly isValid: boolean
	readonly raw: string
	readonly value: string
}

const tokenizeNodeOptions = (nodeOptions: string): NodeOptionToken[] => {
	const tokens: NodeOptionToken[] = []
	let index = 0
	while (index < nodeOptions.length) {
		while (nodeOptions[index] === ' ') index += 1
		if (index >= nodeOptions.length) break
		const start = index
		let value = ''
		let inDoubleQuotes = false
		while (index < nodeOptions.length) {
			const character = nodeOptions[index]
			if (character === undefined) break
			if (inDoubleQuotes) {
				const nextCharacter = nodeOptions[index + 1]
				if (character === '\\' && nextCharacter !== undefined) {
					value += nextCharacter
					index += 2
					continue
				}
				if (character === '"') inDoubleQuotes = false
				else value += character
				index += 1
				continue
			}
			if (character === '"') {
				inDoubleQuotes = true
				index += 1
				continue
			}
			if (character === ' ') break
			value += character
			index += 1
		}
		tokens.push({ isValid: !inDoubleQuotes, raw: nodeOptions.slice(start, index), value })
	}
	return tokens
}

const getExplicitHeapLimitMb = (nodeOptions: string | undefined): string | undefined => {
	if (nodeOptions === undefined) return undefined
	const tokens = tokenizeNodeOptions(nodeOptions)
	let explicitHeapLimitMb: string | undefined
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]
		if (token === undefined || !token.isValid) continue
		const match = EXPLICIT_HEAP_LIMIT_PATTERN.exec(token.value)
		if (match === null) continue
		const explicitValue = match[1]
		if (explicitValue !== undefined) explicitHeapLimitMb = explicitValue
	}
	return explicitHeapLimitMb
}

export const getApplicationTypeScriptNodeOptions = (existingNodeOptions: string | undefined): string | undefined => {
	if (existingNodeOptions === undefined) return undefined
	const tokens = tokenizeNodeOptions(existingNodeOptions)
	const retainedTokens: string[] = []
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]
		if (token === undefined) continue
		if (!token.isValid) {
			retainedTokens.push(token.raw)
			continue
		}
		const match = EXPLICIT_HEAP_LIMIT_PATTERN.exec(token.value)
		if (match === null) {
			retainedTokens.push(token.raw)
			continue
		}
	}
	if (retainedTokens.length === 0) return undefined
	return retainedTokens.join(' ')
}

export function getApplicationTypeScriptHeapOption(existingNodeOptions: string | undefined) {
	const explicitHeapLimitMb = getExplicitHeapLimitMb(existingNodeOptions)
	return `--max-old-space-size=${explicitHeapLimitMb ?? APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`
}

export const getApplicationTypeScriptCommand = (nodeExecutablePath: string, typescriptCliPath: string, existingNodeOptions: string | undefined) => [nodeExecutablePath, getApplicationTypeScriptHeapOption(existingNodeOptions), typescriptCliPath, '--noEmit']

export async function runApplicationTypeScript() {
	const nodeExecutablePath = Bun.which('node')
	if (nodeExecutablePath === null) throw new Error('Node.js is required to run the application TypeScript check with its configured heap limit.')

	const childEnvironment = { ...process.env }
	const retainedNodeOptions = getApplicationTypeScriptNodeOptions(process.env['NODE_OPTIONS'])
	if (retainedNodeOptions === undefined) delete childEnvironment['NODE_OPTIONS']
	else childEnvironment['NODE_OPTIONS'] = retainedNodeOptions

	const child = Bun.spawn({
		cmd: getApplicationTypeScriptCommand(nodeExecutablePath, TYPESCRIPT_CLI_PATH, process.env['NODE_OPTIONS']),
		env: childEnvironment,
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

import { describe, expect, test } from 'bun:test'
import { APPLICATION_TYPESCRIPT_HEAP_MB, getApplicationTypeScriptCommand, getApplicationTypeScriptEnvironment, getApplicationTypeScriptHeapOption, getApplicationTypeScriptNodeOptions } from './run-app-typescript.mts'

const DEFAULT_HEAP_OPTION = `--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`
const PRINT_HEAP_AND_TITLE = 'console.log(JSON.stringify({ heapOption: process.execArgv[0], title: process.title }))'

const requireNode = () => {
	const nodeExecutablePath = Bun.which('node')
	if (nodeExecutablePath === null) throw new Error('Node.js is required for the application TypeScript NODE_OPTIONS regression tests')
	return nodeExecutablePath
}

const spawnNode = (leadingArgs: readonly string[], script: string, env: Record<string, string | undefined>) =>
	Bun.spawnSync([requireNode(), ...leadingArgs, '--input-type=module', '--eval', script], {
		env,
		stderr: 'pipe',
		stdout: 'pipe',
	})

const runNode = (leadingArgs: readonly string[], script: string, env: Record<string, string | undefined>) => {
	const result = spawnNode(leadingArgs, script, env)
	if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
	return new TextDecoder().decode(result.stdout).trim()
}

const inheritedEnvironment = (nodeOptions: string) => getApplicationTypeScriptEnvironment({ ...process.env, NODE_OPTIONS: nodeOptions })

describe('application TypeScript process arguments', () => {
	test('uses the repository default when NODE_OPTIONS does not set a heap limit', () => {
		expect(getApplicationTypeScriptHeapOption(undefined)).toBe(DEFAULT_HEAP_OPTION)
		expect(getApplicationTypeScriptHeapOption(' --trace-warnings ')).toBe(DEFAULT_HEAP_OPTION)
	})

	test('passes an explicit V8 heap limit directly to Node', () => {
		expect(getApplicationTypeScriptHeapOption('--max-old-space-size=8192')).toBe('--max-old-space-size=8192')
		expect(getApplicationTypeScriptHeapOption('--trace-warnings --max_old_space_size 7168')).toBe(DEFAULT_HEAP_OPTION)
		expect(getApplicationTypeScriptHeapOption('--max_old_space_size=+7168')).toBe('--max-old-space-size=7168')
		expect(getApplicationTypeScriptHeapOption('--max-old-space-size="7168" "--max_old_space_size=8192"')).toBe('--max-old-space-size=8192')
		expect(getApplicationTypeScriptCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\projects\\zoltar\\node_modules\\typescript\\bin\\tsc', '--trace-warnings')).toEqual([
			'C:\\Program Files\\nodejs\\node.exe',
			'--max-old-space-size=6144',
			'C:\\projects\\zoltar\\node_modules\\typescript\\bin\\tsc',
			'--project',
			'ui/coreShared/tsconfig.json',
			'--noEmit',
		])
	})

	test('preserves the effective heap limit from quoted and repeated NODE_OPTIONS', () => {
		const nodeOptions = '--max-old-space-size="256" "--max_old_space_size=384"'
		expect(runNode([getApplicationTypeScriptHeapOption(nodeOptions)], 'console.log(process.execArgv[0])', inheritedEnvironment(nodeOptions))).toBe('--max-old-space-size=384')
	})

	test('removes heap flags from inherited NODE_OPTIONS while preserving other options', () => {
		expect(getApplicationTypeScriptNodeOptions('--trace-warnings --max-old-space-size="7168" "--max_old_space_size=8192"')).toBe('--trace-warnings')
		expect(getApplicationTypeScriptNodeOptions('--max-old-space-size 7168')).toBe('--max-old-space-size 7168')
		expect(getApplicationTypeScriptEnvironment({ NODE_OPTIONS: '--max-old-space-size=8192', PATH: 'kept' })).toEqual({ PATH: 'kept' })
		expect(getApplicationTypeScriptEnvironment({ NODE_OPTIONS: '--trace-warnings --max-old-space-size=8192', PATH: 'kept' })).toEqual({ NODE_OPTIONS: '--trace-warnings', PATH: 'kept' })
		expect(getApplicationTypeScriptEnvironment({ Node_Options: '--max-old-space-size=8192', PATH: 'kept' }, 'win32')).toEqual({ PATH: 'kept' })
		expect(getApplicationTypeScriptEnvironment({ Node_Options: '--trace-warnings --max-old-space-size=8192', PATH: 'kept' }, 'win32')).toEqual({ NODE_OPTIONS: '--trace-warnings', PATH: 'kept' })
	})

	test.each([
		{ name: 'preserves escaped quotes in non-heap NODE_OPTIONS', nodeOptions: '--title="hello \\"world\\"" --max-old-space-size=384', childNodeOptions: '--title="hello \\"world\\""', title: 'hello "world"' },
		{ name: 'treats apostrophes as literals while finding a later heap option', nodeOptions: "--title=Codex's --max-old-space-size=384", childNodeOptions: "--title=Codex's", title: "Codex's" },
		{ name: 'decodes escaped heap digits while preserving raw non-heap options', nodeOptions: '--title="kept \\q" --max-old-space-size="3\\84"', childNodeOptions: '--title="kept \\q"', title: 'kept q' },
	])('$name', ({ nodeOptions, childNodeOptions, title }) => {
		expect(getApplicationTypeScriptNodeOptions(nodeOptions)).toBe(childNodeOptions)
		const output: unknown = JSON.parse(runNode([getApplicationTypeScriptHeapOption(nodeOptions)], PRINT_HEAP_AND_TITLE, inheritedEnvironment(nodeOptions)))
		expect(output).toEqual({ heapOption: '--max-old-space-size=384', title })
	})

	test('treats tabs as literal option content instead of heap delimiters', () => {
		const nodeOptions = '--title=a\t--max-old-space-size=7168'
		expect(getApplicationTypeScriptNodeOptions(nodeOptions)).toBe(nodeOptions)
		expect(getApplicationTypeScriptHeapOption(nodeOptions)).toBe(DEFAULT_HEAP_OPTION)
		expect(runNode([], 'console.log(process.title)', inheritedEnvironment(nodeOptions))).toBe('a\t--max-old-space-size=7168')
	})

	test.each(['--max-old-space-size="7168', '--max-old-space-size', '--max-old-space-size 7168'])('preserves malformed heap option %p so Node reports it', nodeOptions => {
		expect(getApplicationTypeScriptNodeOptions(nodeOptions)).toBe(nodeOptions)
		expect(getApplicationTypeScriptHeapOption(nodeOptions)).toBe(DEFAULT_HEAP_OPTION)
		expect(spawnNode([getApplicationTypeScriptHeapOption(nodeOptions)], '', inheritedEnvironment(nodeOptions)).exitCode).not.toBe(0)
	})

	test('honors a leading plus in an inline heap value', () => {
		const nodeOptions = '--max-old-space-size=+384'
		expect(getApplicationTypeScriptNodeOptions(nodeOptions)).toBeUndefined()
		const env = getApplicationTypeScriptEnvironment({ ...process.env, Node_Options: '--max-old-space-size=512', NODE_OPTIONS: nodeOptions }, 'win32')
		expect(runNode([getApplicationTypeScriptHeapOption(nodeOptions)], 'console.log(process.execArgv[0])', env)).toBe('--max-old-space-size=384')
	})
})

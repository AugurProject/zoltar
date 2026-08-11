import { describe, expect, test } from 'bun:test'
import { APPLICATION_TYPESCRIPT_HEAP_MB, getApplicationTypeScriptCommand, getApplicationTypeScriptEnvironment, getApplicationTypeScriptHeapOption, getApplicationTypeScriptNodeOptions } from './run-app-typescript.mts'

describe('application TypeScript process arguments', () => {
	test('uses the repository default when NODE_OPTIONS does not set a heap limit', () => {
		expect(getApplicationTypeScriptHeapOption(undefined)).toBe(`--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`)
		expect(getApplicationTypeScriptHeapOption(' --trace-warnings ')).toBe(`--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`)
	})

	test('passes an explicit V8 heap limit directly to Node', () => {
		expect(getApplicationTypeScriptHeapOption('--max-old-space-size=8192')).toBe('--max-old-space-size=8192')
		expect(getApplicationTypeScriptHeapOption('--trace-warnings --max_old_space_size 7168')).toBe(`--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`)
		expect(getApplicationTypeScriptHeapOption('--max_old_space_size=+7168')).toBe('--max-old-space-size=7168')
		expect(getApplicationTypeScriptHeapOption('--max-old-space-size="7168" "--max_old_space_size=8192"')).toBe('--max-old-space-size=8192')
		expect(getApplicationTypeScriptCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\projects\\zoltar\\node_modules\\typescript\\bin\\tsc', '--trace-warnings')).toEqual(['C:\\Program Files\\nodejs\\node.exe', '--max-old-space-size=6144', 'C:\\projects\\zoltar\\node_modules\\typescript\\bin\\tsc', '--noEmit'])
	})

	test('preserves the effective heap limit from quoted and repeated NODE_OPTIONS', () => {
		const nodeExecutablePath = Bun.which('node')
		if (nodeExecutablePath === null) throw new Error('Node.js is required for the application TypeScript heap regression test')
		const nodeOptions = '--max-old-space-size="256" "--max_old_space_size=384"'
		const result = Bun.spawnSync([nodeExecutablePath, getApplicationTypeScriptHeapOption(nodeOptions), '--input-type=module', '--eval', 'console.log(process.execArgv[0])'], {
			env: getApplicationTypeScriptEnvironment({ ...process.env, NODE_OPTIONS: nodeOptions }),
			stderr: 'pipe',
			stdout: 'pipe',
		})
		if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
		expect(new TextDecoder().decode(result.stdout).trim()).toBe('--max-old-space-size=384')
	})

	test('removes heap flags from inherited NODE_OPTIONS while preserving other options', () => {
		expect(getApplicationTypeScriptNodeOptions('--trace-warnings --max-old-space-size="7168" "--max_old_space_size=8192"')).toBe('--trace-warnings')
		expect(getApplicationTypeScriptNodeOptions('--max-old-space-size 7168')).toBe('--max-old-space-size 7168')
		expect(getApplicationTypeScriptEnvironment({ NODE_OPTIONS: '--max-old-space-size=8192', PATH: 'kept' })).toEqual({ PATH: 'kept' })
		expect(getApplicationTypeScriptEnvironment({ NODE_OPTIONS: '--trace-warnings --max-old-space-size=8192', PATH: 'kept' })).toEqual({ NODE_OPTIONS: '--trace-warnings', PATH: 'kept' })
		expect(getApplicationTypeScriptEnvironment({ Node_Options: '--max-old-space-size=8192', PATH: 'kept' }, 'win32')).toEqual({ PATH: 'kept' })
		expect(getApplicationTypeScriptEnvironment({ Node_Options: '--trace-warnings --max-old-space-size=8192', PATH: 'kept' }, 'win32')).toEqual({ NODE_OPTIONS: '--trace-warnings', PATH: 'kept' })
	})

	test('preserves escaped quotes in non-heap NODE_OPTIONS', () => {
		const nodeExecutablePath = Bun.which('node')
		if (nodeExecutablePath === null) throw new Error('Node.js is required for the application TypeScript option-preservation test')
		const nodeOptions = '--title="hello \\"world\\"" --max-old-space-size=384'
		const childNodeOptions = getApplicationTypeScriptNodeOptions(nodeOptions)
		expect(childNodeOptions).toBe('--title="hello \\"world\\""')
		const result = Bun.spawnSync([nodeExecutablePath, getApplicationTypeScriptHeapOption(nodeOptions), '--input-type=module', '--eval', 'console.log(JSON.stringify({ heapOption: process.execArgv[0], title: process.title }))'], {
			env: getApplicationTypeScriptEnvironment({ ...process.env, NODE_OPTIONS: nodeOptions }),
			stderr: 'pipe',
			stdout: 'pipe',
		})
		if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as { heapOption: string; title: string }
		expect(output.title).toBe('hello "world"')
		expect(output.heapOption).toBe('--max-old-space-size=384')
	})

	test('treats apostrophes as literals while finding a later heap option', () => {
		const nodeExecutablePath = Bun.which('node')
		if (nodeExecutablePath === null) throw new Error('Node.js is required for the application TypeScript apostrophe regression test')
		const nodeOptions = "--title=Codex's --max-old-space-size=384"
		const childNodeOptions = getApplicationTypeScriptNodeOptions(nodeOptions)
		expect(childNodeOptions).toBe("--title=Codex's")
		const result = Bun.spawnSync([nodeExecutablePath, getApplicationTypeScriptHeapOption(nodeOptions), '--input-type=module', '--eval', 'console.log(JSON.stringify({ heapOption: process.execArgv[0], title: process.title }))'], {
			env: getApplicationTypeScriptEnvironment({ ...process.env, NODE_OPTIONS: nodeOptions }),
			stderr: 'pipe',
			stdout: 'pipe',
		})
		if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as { heapOption: string; title: string }
		expect(output.title).toBe("Codex's")
		expect(output.heapOption).toBe('--max-old-space-size=384')
	})

	test('decodes escaped heap digits while preserving raw non-heap options', () => {
		const nodeExecutablePath = Bun.which('node')
		if (nodeExecutablePath === null) throw new Error('Node.js is required for the application TypeScript escape regression test')
		const nodeOptions = '--title="kept \\q" --max-old-space-size="3\\84"'
		const childNodeOptions = getApplicationTypeScriptNodeOptions(nodeOptions)
		expect(childNodeOptions).toBe('--title="kept \\q"')
		const result = Bun.spawnSync([nodeExecutablePath, getApplicationTypeScriptHeapOption(nodeOptions), '--input-type=module', '--eval', 'console.log(JSON.stringify({ heapOption: process.execArgv[0], title: process.title }))'], {
			env: getApplicationTypeScriptEnvironment({ ...process.env, NODE_OPTIONS: nodeOptions }),
			stderr: 'pipe',
			stdout: 'pipe',
		})
		if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as { heapOption: string; title: string }
		expect(output.title).toBe('kept q')
		expect(output.heapOption).toBe('--max-old-space-size=384')
	})

	test('treats tabs as literal option content instead of heap delimiters', () => {
		const nodeExecutablePath = Bun.which('node')
		if (nodeExecutablePath === null) throw new Error('Node.js is required for the application TypeScript delimiter regression test')
		const nodeOptions = '--title=a\t--max-old-space-size=7168'
		const childNodeOptions = getApplicationTypeScriptNodeOptions(nodeOptions)
		expect(childNodeOptions).toBe(nodeOptions)
		expect(getApplicationTypeScriptHeapOption(nodeOptions)).toBe(`--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`)
		const result = Bun.spawnSync([nodeExecutablePath, '--input-type=module', '--eval', 'console.log(process.title)'], {
			env: getApplicationTypeScriptEnvironment({ ...process.env, NODE_OPTIONS: nodeOptions }),
			stderr: 'pipe',
			stdout: 'pipe',
		})
		if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
		expect(new TextDecoder().decode(result.stdout).trim()).toBe('a\t--max-old-space-size=7168')
	})

	test('preserves malformed heap options so Node reports them', () => {
		const nodeExecutablePath = Bun.which('node')
		if (nodeExecutablePath === null) throw new Error('Node.js is required for the application TypeScript malformed-option regression test')
		for (const nodeOptions of ['--max-old-space-size="7168', '--max-old-space-size', '--max-old-space-size 7168']) {
			const childNodeOptions = getApplicationTypeScriptNodeOptions(nodeOptions)
			expect(childNodeOptions).toBe(nodeOptions)
			expect(getApplicationTypeScriptHeapOption(nodeOptions)).toBe(`--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`)
			const result = Bun.spawnSync([nodeExecutablePath, getApplicationTypeScriptHeapOption(nodeOptions), '--input-type=module', '--eval', ''], {
				env: getApplicationTypeScriptEnvironment({ ...process.env, NODE_OPTIONS: nodeOptions }),
				stderr: 'pipe',
				stdout: 'pipe',
			})
			expect(result.exitCode).not.toBe(0)
		}
	})

	test('honors a leading plus in an inline heap value', () => {
		const nodeExecutablePath = Bun.which('node')
		if (nodeExecutablePath === null) throw new Error('Node.js is required for the application TypeScript signed-value regression test')
		const nodeOptions = '--max-old-space-size=+384'
		const childNodeOptions = getApplicationTypeScriptNodeOptions(nodeOptions)
		expect(childNodeOptions).toBeUndefined()
		const result = Bun.spawnSync([nodeExecutablePath, getApplicationTypeScriptHeapOption(nodeOptions), '--input-type=module', '--eval', 'console.log(process.execArgv[0])'], {
			env: getApplicationTypeScriptEnvironment({ ...process.env, Node_Options: '--max-old-space-size=512', NODE_OPTIONS: nodeOptions }, 'win32'),
			stderr: 'pipe',
			stdout: 'pipe',
		})
		if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
		expect(new TextDecoder().decode(result.stdout).trim()).toBe('--max-old-space-size=384')
	})
})

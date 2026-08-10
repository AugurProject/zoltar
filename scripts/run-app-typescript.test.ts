import { describe, expect, test } from 'bun:test'
import { APPLICATION_TYPESCRIPT_HEAP_MB, getApplicationTypeScriptCommand, getApplicationTypeScriptHeapOption } from './run-app-typescript.mts'

describe('application TypeScript process arguments', () => {
	test('uses the repository default when NODE_OPTIONS does not set a heap limit', () => {
		expect(getApplicationTypeScriptHeapOption(undefined)).toBe(`--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`)
		expect(getApplicationTypeScriptHeapOption(' --trace-warnings ')).toBe(`--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`)
	})

	test('passes an explicit V8 heap limit directly to Node', () => {
		expect(getApplicationTypeScriptHeapOption('--max-old-space-size=8192')).toBe('--max-old-space-size=8192')
		expect(getApplicationTypeScriptHeapOption('--trace-warnings --max_old_space_size 7168')).toBe('--max-old-space-size=7168')
		expect(getApplicationTypeScriptHeapOption('--max-old-space-size="7168" "--max_old_space_size=8192"')).toBe('--max-old-space-size=8192')
		expect(getApplicationTypeScriptCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\projects\\zoltar\\node_modules\\typescript\\bin\\tsc', '--trace-warnings')).toEqual(['C:\\Program Files\\nodejs\\node.exe', '--max-old-space-size=6144', 'C:\\projects\\zoltar\\node_modules\\typescript\\bin\\tsc', '--noEmit'])
	})

	test('preserves the effective heap limit from quoted and repeated NODE_OPTIONS', () => {
		const nodeExecutablePath = Bun.which('node')
		if (nodeExecutablePath === null) throw new Error('Node.js is required for the application TypeScript heap regression test')
		const nodeOptions = '--max-old-space-size="7168" "--max_old_space_size=8192"'
		const result = Bun.spawnSync([nodeExecutablePath, getApplicationTypeScriptHeapOption(nodeOptions), '--input-type=module', '--eval', "import { getHeapStatistics } from 'node:v8'; console.log(getHeapStatistics().heap_size_limit)"], {
			env: { ...process.env, NODE_OPTIONS: nodeOptions },
			stderr: 'pipe',
			stdout: 'pipe',
		})
		if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
		const heapLimitBytes = Number(new TextDecoder().decode(result.stdout).trim())
		expect(heapLimitBytes).toBeGreaterThanOrEqual(8192 * 1024 * 1024)
	})
})

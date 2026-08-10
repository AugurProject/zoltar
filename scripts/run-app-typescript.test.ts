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
		expect(getApplicationTypeScriptCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\projects\\zoltar\\node_modules\\typescript\\bin\\tsc', '--trace-warnings')).toEqual(['C:\\Program Files\\nodejs\\node.exe', '--max-old-space-size=6144', 'C:\\projects\\zoltar\\node_modules\\typescript\\bin\\tsc', '--noEmit'])
	})
})

import { describe, expect, test } from 'bun:test'
import { APPLICATION_TYPESCRIPT_HEAP_MB, getApplicationTypeScriptNodeOptions } from './run-app-typescript.mts'

describe('application TypeScript heap options', () => {
	test('adds the repository default when NODE_OPTIONS does not set a heap limit', () => {
		expect(getApplicationTypeScriptNodeOptions(undefined)).toBe(`--max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`)
		expect(getApplicationTypeScriptNodeOptions(' --trace-warnings ')).toBe(`--trace-warnings --max-old-space-size=${APPLICATION_TYPESCRIPT_HEAP_MB.toString()}`)
	})

	test('preserves an explicit V8 heap limit', () => {
		expect(getApplicationTypeScriptNodeOptions('--max-old-space-size=8192')).toBe('--max-old-space-size=8192')
		expect(getApplicationTypeScriptNodeOptions('--trace-warnings --max_old_space_size=7168')).toBe('--trace-warnings --max_old_space_size=7168')
	})
})

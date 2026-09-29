import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import * as ts from 'typescript'
import { getCiPreflightTasks } from './run-ci-preflight.mts'

test('Solidity typechecking resolves UI imports from source before UI compilation', () => {
	const root = resolve(import.meta.dir, '../..')
	const configPath = resolve(root, 'solidity/tsconfig.typecheck.json')
	const config = ts.readConfigFile(configPath, ts.sys.readFile)
	if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(root, 'solidity'))
	expect(parsed.errors).toEqual([])
	for (const [specifier, source] of [
		['@zoltar/ui-core-shared/copy/common.js', 'ui/coreShared/ts/copy/common.ts'],
		['@zoltar/ui-zoltar-shared/copy/market.js', 'ui/zoltarShared/ts/copy/market.ts'],
		['@zoltar/ui-statoblast-shared/contractArtifact.js', 'ui/statoblastShared/ts/contractArtifact.ts'],
		['@zoltar/core-shared/evm/ethereum', 'shared/core/ts/evm/ethereum.ts'],
	] as const) {
		const resolved = ts.resolveModuleName(specifier, resolve(root, 'ui/trading/ts/protocol/authorization.ts'), parsed.options, ts.sys).resolvedModule
		if (resolved === undefined) throw new Error(`Unable to resolve ${specifier} for Solidity typechecking`)
		expect(resolve(resolved.resolvedFileName)).toBe(resolve(root, source))
	}
})

test('CI preflight preserves non-UI checks and production bundling without checking emitted UI projects twice', () => {
	expect(getCiPreflightTasks([]).map(task => task.command)).toEqual([
		['run', 'tsc:scripts'],
		['run', 'tsc:solidity:current'],
		['run', 'ui:build:prod:current'],
	])
})

test('the parallel checks job runs both remaining typechecks without producing a second UI bundle', () => {
	expect(getCiPreflightTasks(['--typecheck-only']).map(task => task.command)).toEqual([
		['run', 'tsc:scripts'],
		['run', 'tsc:solidity:current'],
	])
})

test.each([{ args: ['--unknown'] }, { args: ['--typecheck-only', '--typecheck-only'] }])('rejects invalid preflight arguments %j', ({ args }) => {
	expect(() => getCiPreflightTasks(args)).toThrow('Expected no arguments or --typecheck-only')
})

import { expect, test } from 'bun:test'
import { getCiPreflightTasks } from './run-ci-preflight.mts'

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

import { expect, test } from 'bun:test'
import { auditTestOwnership, botTestScriptOwnsTestsDirectory, isPackageTestOwned } from './test-ownership.mts'

test('every repository test and package test/check entrypoint has exactly one intended owner', async () => {
	const audit = await auditTestOwnership()
	expect(audit.errors).toEqual([])
	expect(audit.packageDirectories).toContain('bots/chaos')
	expect(audit.externalIntegrationTests).toEqual(['augurScan/tests/postgres.integration.test.ts'])
})

test('package ownership matches the package commands tests directory exactly', () => {
	expect(isPackageTestOwned('bots/chaos', 'bots/chaos/tests/example.test.ts')).toBe(true)
	expect(isPackageTestOwned('bots/chaos', 'bots/chaos/src/example.test.ts')).toBe(false)
	expect(botTestScriptOwnsTestsDirectory('bun test ./tests')).toBe(true)
	expect(botTestScriptOwnsTestsDirectory('bun test ./tests/only.test.ts')).toBe(false)
})

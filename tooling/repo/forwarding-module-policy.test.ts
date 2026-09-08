import { expect, test } from 'bun:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { forwardingModules, intentionalForwardingModules, isForwardingModule, unapprovedForwardingModules } from './forwarding-module-policy.ts'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('detects source modules whose only behavior is forwarding imports or exports', () => {
	expect(isForwardingModule('forwarder.ts', "import './bootstrap.js'\nexport { value } from './owner.js'\n")).toBe(true)
	expect(isForwardingModule('implementation.ts', "import { value } from './owner.js'\nexport const doubled = value * 2\n")).toBe(false)
})

test('requires every forwarding-only source module to be intentional and reasoned', async () => {
	const discovered = new Set(await forwardingModules(repositoryRoot))

	expect(await unapprovedForwardingModules(repositoryRoot)).toEqual([])
	for (const [sourcePath, reason] of Object.entries(intentionalForwardingModules)) {
		expect(reason.trim().length, `${sourcePath} must have a useful reason`).toBeGreaterThan(20)
		expect(discovered.has(sourcePath), `${sourcePath} is allowlisted but is no longer forwarding-only`).toBe(true)
	}
})

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { validateLegacyZodAuditScope } from './audit-dependencies.mts'
import { repositoryRoot } from './root.mts'

const locked = (name: string, version: string, dependencies: Record<string, string> = {}) => [`${name}@${version}`, '', { dependencies }] as const

const fixture = () => ({
	workspaces: { '': { devDependencies: { knip: '6.17.1' } } },
	packages: {
		'@tevm/base-bundler': locked('@tevm/base-bundler', '1.0.0-rc.151', { '@tevm/compiler': '^1.0.0-rc.151' }),
		'@tevm/bundler-cache': locked('@tevm/bundler-cache', '1.0.0-rc.151', { '@tevm/compiler': '^1.0.0-rc.151' }),
		'@tevm/compiler': locked('@tevm/compiler', '1.0.0-rc.151', { 'solc-typed-ast': '^18.2.5' }),
		'solc-typed-ast': locked('solc-typed-ast', '18.2.6', { 'web3-eth-abi': '^4.2.0' }),
		'web3-eth-abi': locked('web3-eth-abi', '4.4.1', { 'web3-validator': '^2.0.6', 'web3-utils': '^4.3.3' }),
		'web3-utils': locked('web3-utils', '4.3.3', { 'web3-validator': '^2.0.6' }),
		'web3-validator': locked('web3-validator', '2.0.6', { zod: '^3.21.4' }),
		'web3-validator/zod': locked('zod', '3.25.76'),
		zod: locked('zod', '4.6.6'),
	},
})

test('accepts only the inspected compiler legacy dependency alongside patched runtime Zod', () => {
	expect(() => validateLegacyZodAuditScope(fixture())).not.toThrow()
	const newer = fixture()
	newer.packages.zod = locked('zod', '4.6.7')
	expect(() => validateLegacyZodAuditScope(newer)).not.toThrow()
})

test('the installed workspace lockfile meets the reviewed exception boundary', () => {
	expect(() => validateLegacyZodAuditScope(Bun.JSONC.parse(readFileSync(path.join(repositoryRoot, 'bun.lock'), 'utf8')))).not.toThrow()
})

test('rejects vulnerable or unreviewed runtime Zod even though its advisory is otherwise accepted', () => {
	for (const version of ['4.6.5', '4.5.99', '4.6.6-beta.1', '3.25.76']) {
		const lockfile = fixture()
		lockfile.packages.zod = locked('zod', version)
		expect(() => validateLegacyZodAuditScope(lockfile)).toThrow('Zod audit exception')
	}
})

test('rejects additional legacy copies and changes to the inspected legacy version', () => {
	const additional = fixture()
	Object.assign(additional.packages, { 'runtime-client/zod': locked('zod', '3.25.76') })
	expect(() => validateLegacyZodAuditScope(additional)).toThrow('Zod audit exception')
	const changed = fixture()
	changed.packages['web3-validator/zod'] = locked('zod', '3.25.75')
	expect(() => validateLegacyZodAuditScope(changed)).toThrow('Zod audit exception')
})

test('rejects a new parent of the legacy dependency chain and a direct workspace dependency', () => {
	for (const dependency of ['@tevm/compiler', 'solc-typed-ast', 'web3-eth-abi', 'web3-utils', 'web3-validator']) {
		const newParent = fixture()
		Object.assign(newParent.packages, { 'runtime-client': locked('runtime-client', '1.0.0', { [dependency]: '*' }) })
		expect(() => validateLegacyZodAuditScope(newParent)).toThrow('Zod audit exception')
		const direct = fixture()
		Object.assign(direct.workspaces[''].devDependencies, { [dependency]: '*' })
		expect(() => validateLegacyZodAuditScope(direct)).toThrow('Zod audit exception')
	}
})

test('rejects unreviewed compiler dependencies and malformed lockfiles', () => {
	const changed = fixture()
	changed.packages['web3-validator'] = locked('web3-validator', '2.0.7', { zod: '^3.21.4' })
	expect(() => validateLegacyZodAuditScope(changed)).toThrow('Zod audit exception')
	for (const malformed of [undefined, {}, { packages: {} }, { workspaces: {}, packages: { zod: {} } }]) expect(() => validateLegacyZodAuditScope(malformed)).toThrow('Zod audit exception')
})

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { validateLegacyZodAuditScope, validatePicomatchAuditScope } from './audit-dependencies.mts'
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

const globbingFixture = () => ({
	workspaces: { '': { devDependencies: { knip: '6.17.1' } }, solidity: { devDependencies: { knip: '6.17.1' } } },
	packages: {
		picomatch: locked('picomatch', '4.0.7'),
		'micromatch/picomatch': locked('picomatch', '2.3.2'),
		knip: locked('knip', '6.17.1', { picomatch: '^4.0.4', fdir: '^6.5.0', tinyglobby: '^0.2.17' }),
		fdir: ['fdir@6.5.0', '', { peerDependencies: { picomatch: '^3 || ^4' } }],
		tinyglobby: locked('tinyglobby', '0.2.17', { picomatch: '^4.0.4', fdir: '^6.5.0' }),
		vitest: locked('vitest', '4.1.12', { picomatch: '^4.0.3', vite: '^8.0.0', tinyglobby: '^0.2.15' }),
		vite: locked('vite', '8.3.3', { picomatch: '^4.0.7', tinyglobby: '^0.2.17' }),
		unplugin: locked('unplugin', '3.3.0', { picomatch: '^4.0.4' }),
		micromatch: locked('micromatch', '4.0.8', { picomatch: '^2.3.1' }),
		'findup-sync': locked('findup-sync', '5.0.0', { micromatch: '^4.0.4' }),
		'@vitest/mocker': ['@vitest/mocker@4.1.12', '', { peerDependencies: { vite: '^8.0.0' } }],
		'@tevm/memory-client': locked('@tevm/memory-client', '1.0.0-rc.151', { vitest: '^4.1.6' }),
		'@tevm/unplugin': locked('@tevm/unplugin', '1.0.0-rc.151', { unplugin: '^3.0.0' }),
		'solc-typed-ast': locked('solc-typed-ast', '18.2.6', { 'findup-sync': '^5.0.0' }),
	},
})

test('accepts the inspected tooling-only picomatch graph and installed lockfile', () => {
	expect(() => validatePicomatchAuditScope(globbingFixture())).not.toThrow()
	expect(() => validatePicomatchAuditScope(Bun.JSONC.parse(readFileSync(path.join(repositoryRoot, 'bun.lock'), 'utf8')))).not.toThrow()
})

test('requires picomatch exception review for upgrades, missing copies and additional copies', () => {
	const upgraded = globbingFixture()
	upgraded.packages.picomatch = locked('picomatch', '4.0.8')
	expect(() => validatePicomatchAuditScope(upgraded)).toThrow('reviewed copy picomatch changed')
	const missing = globbingFixture()
	Reflect.deleteProperty(missing.packages, 'micromatch/picomatch')
	expect(() => validatePicomatchAuditScope(missing)).toThrow('reviewed copy micromatch/picomatch changed')
	const additional = globbingFixture()
	Object.assign(additional.packages, { 'runtime-client/picomatch': locked('picomatch', '4.0.7') })
	expect(() => validatePicomatchAuditScope(additional)).toThrow('additional picomatch copy')
	const inheritedName = globbingFixture()
	Object.assign(inheritedName.packages, { constructor: locked('picomatch', '4.0.7') })
	expect(() => validatePicomatchAuditScope(inheritedName)).toThrow('additional picomatch copy')
})

test('rejects changed tooling versions and extra copies of reviewed tooling', () => {
	const changed = globbingFixture()
	changed.packages.vite = locked('vite', '8.3.4', { picomatch: '^4.0.7' })
	expect(() => validatePicomatchAuditScope(changed)).toThrow('globbing dependency vite changed')
	const additional = globbingFixture()
	Object.assign(additional.packages, { 'runtime-client/vite': locked('vite', '8.3.3', { picomatch: '^4.0.7' }) })
	expect(() => validatePicomatchAuditScope(additional)).toThrow('additional globbing dependency')
})

test('rejects new parents anywhere along the reviewed globbing paths in every dependency group', () => {
	for (const dependency of ['picomatch', 'knip', 'fdir', 'tinyglobby', 'vite', 'vitest', 'unplugin', 'micromatch', 'findup-sync']) {
		for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
			const lockfile = globbingFixture()
			Object.assign(lockfile.packages, { 'runtime-client': ['runtime-client@1.0.0', '', { [group]: { [dependency]: '*' } }] })
			expect(() => validatePicomatchAuditScope(lockfile)).toThrow(`unexpected globbing path runtime-client > ${dependency}`)
		}
	}
})

test('rejects direct workspace globbing use except the two existing Knip dev dependencies', () => {
	for (const dependency of ['picomatch', 'knip', 'fdir', 'tinyglobby', 'vite', 'vitest', 'unplugin', 'micromatch', 'findup-sync']) {
		for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
			const lockfile = globbingFixture()
			Object.assign(lockfile.workspaces, { 'new-app': { [group]: { [dependency]: '*' } } })
			expect(() => validatePicomatchAuditScope(lockfile)).toThrow('direct workspace globbing dependency')
		}
	}
	const runtimeKnip = globbingFixture()
	Object.assign(runtimeKnip.workspaces[''], { dependencies: { knip: '6.17.1' } })
	expect(() => validatePicomatchAuditScope(runtimeKnip)).toThrow('direct workspace globbing dependency')
})

test('rejects malformed picomatch scope metadata rather than silently accepting an ignored advisory', () => {
	for (const malformed of [undefined, {}, { packages: {} }, { workspaces: {}, packages: {} }]) expect(() => validatePicomatchAuditScope(malformed)).toThrow('Picomatch audit exception')
	for (const entry of [{}, ['runtime-client@1.0.0', '', []], ['runtime-client@1.0.0', '', { optionalDependencies: [] }]]) {
		const lockfile = globbingFixture()
		Object.assign(lockfile.packages, { 'runtime-client': entry })
		expect(() => validatePicomatchAuditScope(lockfile)).toThrow('Picomatch audit exception')
	}
})

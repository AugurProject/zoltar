import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { validatePicomatchAuditScope } from './picomatch-audit-scope.ts'
import { repositoryRoot } from './root.mts'

const locked = (name: string, version: string, dependencies: Record<string, string> = {}) => [`${name}@${version}`, '', { dependencies }] as const
const fixture = () => ({
	workspaces: { '': { devDependencies: { knip: '6.17.1' } } },
	packages: {
		picomatch: locked('picomatch', '4.0.7'),
		'micromatch/picomatch': locked('picomatch', '2.3.2'),
		fdir: locked('fdir', '6.5.0', { picomatch: '^3 || ^4' }),
		knip: locked('knip', '6.17.1', { picomatch: '^4.0.4' }),
		tinyglobby: locked('tinyglobby', '0.2.17', { picomatch: '^4.0.4' }),
		unplugin: locked('unplugin', '3.3.0', { picomatch: '^4.0.4' }),
		vite: locked('vite', '8.3.3', { picomatch: '^4.0.7' }),
		vitest: locked('vitest', '4.1.12', { picomatch: '^4.0.3' }),
		micromatch: locked('micromatch', '4.0.8', { picomatch: '^2.3.1' }),
	},
})

test('accepts the inspected tooling graph and the current workspace lockfile', () => {
	expect(() => validatePicomatchAuditScope(fixture())).not.toThrow()
	expect(() => validatePicomatchAuditScope(Bun.JSONC.parse(readFileSync(path.join(repositoryRoot, 'bun.lock'), 'utf8')))).not.toThrow()
})

test('new Picomatch copies and changed versions require review, including a future patch', () => {
	const additional = fixture()
	Object.assign(additional.packages, { 'runtime/picomatch': locked('picomatch', '4.0.7') })
	expect(() => validatePicomatchAuditScope(additional)).toThrow('Picomatch audit exception')
	for (const version of ['4.0.6', '4.0.8', '4.0.7-beta.1']) {
		const changed = fixture()
		changed.packages.picomatch = locked('picomatch', version)
		expect(() => validatePicomatchAuditScope(changed)).toThrow('Picomatch audit exception')
	}
})

test('each inspected caller version is part of the exception boundary', () => {
	for (const name of ['fdir', 'knip', 'tinyglobby', 'unplugin', 'vite', 'vitest', 'micromatch']) {
		const changed = fixture()
		Object.assign(changed.packages, { [name]: locked(name, '99.0.0') })
		expect(() => validatePicomatchAuditScope(changed)).toThrow('Picomatch audit exception')
	}
})

test('rejects new callers through every dependency group', () => {
	for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
		for (const name of ['picomatch', 'fdir', 'knip', 'tinyglobby', 'unplugin', 'vite', 'vitest', 'micromatch']) {
			const changed = fixture()
			const caller = locked('runtime-client', '1.0.0')
			Object.assign(caller[2], { [group]: { [name]: '*' } })
			Object.assign(changed.packages, { 'runtime-client': caller })
			expect(() => validatePicomatchAuditScope(changed)).toThrow('unexpected caller')
		}
	}
})

test('rejects direct workspace use of the inspected tooling except development Knip', () => {
	for (const name of ['picomatch', 'micromatch', 'fdir', 'tinyglobby', 'unplugin', 'vite', 'vitest']) {
		const changed = fixture()
		Object.assign(changed.workspaces[''].devDependencies, { [name]: '*' })
		expect(() => validatePicomatchAuditScope(changed)).toThrow('direct workspace dependency')
	}
	const productionKnip = fixture()
	Object.assign(productionKnip.workspaces[''], { dependencies: { knip: '6.17.1' } })
	expect(() => validatePicomatchAuditScope(productionKnip)).toThrow('direct workspace dependency')
})

test('rejects malformed or incomplete lockfiles rather than skipping the guard', () => {
	for (const malformed of [undefined, {}, { packages: {} }, { packages: { picomatch: {} }, workspaces: {} }, { packages: {}, workspaces: {} }]) {
		expect(() => validatePicomatchAuditScope(malformed)).toThrow('Picomatch audit exception')
	}
})

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { acceptedAuditAdvisories } from './projects.ts'
import { repositoryRoot } from './root.mts'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

function fail(reason: string): never {
	throw new Error(`Zod audit exception requires review: ${reason}`)
}
const inspectedPackages = {
	'@tevm/compiler': '1.0.0-rc.151',
	'solc-typed-ast': '18.2.6',
	'web3-eth-abi': '4.4.1',
	'web3-utils': '4.3.3',
	'web3-validator': '2.0.6',
}
const inspectedParents: Readonly<Record<string, readonly string[]>> = {
	'@tevm/compiler': ['@tevm/base-bundler', '@tevm/bundler-cache'],
	'solc-typed-ast': ['@tevm/compiler'],
	'web3-eth-abi': ['solc-typed-ast'],
	'web3-utils': ['web3-eth-abi'],
	'web3-validator': ['web3-eth-abi', 'web3-utils'],
}
const dependencyGroups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

const inspectedGlobbingPackages: Readonly<Record<string, string>> = {
	knip: '6.17.1',
	fdir: '6.5.0',
	tinyglobby: '0.2.17',
	vitest: '4.1.12',
	vite: '8.3.3',
	unplugin: '3.3.0',
	micromatch: '4.0.8',
	'findup-sync': '5.0.0',
	'@vitest/mocker': '4.1.12',
	'@tevm/memory-client': '1.0.0-rc.151',
	'@tevm/unplugin': '1.0.0-rc.151',
	'solc-typed-ast': '18.2.6',
}
const inspectedGlobbingParents: Readonly<Record<string, readonly string[]>> = {
	picomatch: ['knip', 'fdir', 'tinyglobby', 'vitest', 'vite', 'unplugin', 'micromatch'],
	knip: [],
	fdir: ['knip', 'tinyglobby'],
	tinyglobby: ['knip', 'vitest', 'vite'],
	vitest: ['@tevm/memory-client'],
	vite: ['vitest', '@vitest/mocker', 'unplugin'],
	unplugin: ['@tevm/unplugin'],
	micromatch: ['findup-sync'],
	'findup-sync': ['solc-typed-ast'],
}

export function validatePicomatchAuditScope(lockfile: unknown): void {
	function reject(reason: string): never {
		throw new Error(`Picomatch audit exception requires review: ${reason}`)
	}
	if (!isPlainRecord(lockfile)) reject('invalid workspace lockfile')
	const packages = lockfile['packages']
	const workspaces = lockfile['workspaces']
	if (!isPlainRecord(packages) || !isPlainRecord(workspaces)) reject('invalid workspace lockfile')
	const copies: Readonly<Record<string, string>> = { picomatch: '4.0.7', 'micromatch/picomatch': '2.3.2' }
	for (const [key, version] of Object.entries(copies)) {
		const entry = packages[key]
		if (!Array.isArray(entry) || entry[0] !== `picomatch@${version}`) reject(`reviewed copy ${key} changed; remove the exception when a patched release is available`)
	}
	for (const [name, version] of Object.entries(inspectedGlobbingPackages)) {
		const entry = packages[name]
		if (!Array.isArray(entry) || entry[0] !== `${name}@${version}`) reject(`globbing dependency ${name} changed`)
	}
	for (const [key, entry] of Object.entries(packages)) {
		if (!Array.isArray(entry) || typeof entry[0] !== 'string') reject(`invalid package entry ${key}`)
		if (entry[0].startsWith('picomatch@') && !Object.hasOwn(copies, key)) reject(`additional picomatch copy ${key}`)
		for (const name of Object.keys(inspectedGlobbingPackages)) {
			if (entry[0].startsWith(`${name}@`) && key !== name) reject(`additional globbing dependency ${key}`)
		}
		const metadata = entry[2]
		if (metadata === undefined) continue
		if (!isPlainRecord(metadata)) reject(`invalid package metadata ${key}`)
		for (const group of dependencyGroups) {
			const dependencies = metadata[group]
			if (dependencies === undefined) continue
			if (!isPlainRecord(dependencies)) reject(`invalid dependencies for ${key}`)
			for (const dependency of Object.keys(dependencies)) {
				const parents = Object.hasOwn(inspectedGlobbingParents, dependency) ? inspectedGlobbingParents[dependency] : undefined
				if (parents !== undefined && !parents.includes(key)) reject(`unexpected globbing path ${key} > ${dependency}`)
			}
		}
	}
	for (const [workspace, manifest] of Object.entries(workspaces)) {
		if (!isPlainRecord(manifest)) reject(`invalid workspace ${workspace}`)
		for (const group of dependencyGroups) {
			const dependencies = manifest[group]
			if (dependencies === undefined) continue
			if (!isPlainRecord(dependencies)) reject(`invalid workspace dependencies ${workspace}`)
			for (const dependency of Object.keys(dependencies)) {
				if (!Object.hasOwn(inspectedGlobbingParents, dependency)) continue
				if (dependency === 'knip' && group === 'devDependencies' && (workspace === '' || workspace === 'solidity') && dependencies[dependency] === inspectedGlobbingPackages['knip']) continue
				reject(`direct workspace globbing dependency ${workspace} > ${dependency}`)
			}
		}
	}
}

export function validateLegacyZodAuditScope(lockfile: unknown): void {
	if (!isPlainRecord(lockfile)) fail('invalid workspace lockfile')
	const packages = lockfile['packages']
	const workspaces = lockfile['workspaces']
	if (!isPlainRecord(packages) || !isPlainRecord(workspaces)) fail('invalid workspace lockfile')
	let hasLegacyZod = false
	for (const [key, entry] of Object.entries(packages)) {
		if (!Array.isArray(entry) || typeof entry[0] !== 'string') fail(`invalid package entry ${key}`)
		if (!entry[0].startsWith('zod@')) continue
		const version = entry[0].slice(4)
		if (key === 'web3-validator/zod' && version === '3.25.76') {
			hasLegacyZod = true
			continue
		}
		const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
		if (match === null || Number(match[1]) < 4 || (Number(match[1]) === 4 && (Number(match[2]) < 6 || (Number(match[2]) === 6 && Number(match[3]) < 6)))) fail(`unpatched or unreviewed ${key}@${version}`)
	}
	if (!hasLegacyZod) return
	for (const [name, version] of Object.entries(inspectedPackages)) {
		const entry = packages[name]
		if (!Array.isArray(entry) || entry[0] !== `${name}@${version}`) fail(`legacy dependency ${name} changed`)
	}
	for (const [key, entry] of Object.entries(packages)) {
		if (!Array.isArray(entry)) fail(`invalid package entry ${key}`)
		for (const name of Object.keys(inspectedPackages)) {
			if (typeof entry[0] === 'string' && entry[0].startsWith(`${name}@`) && key !== name) fail(`additional legacy dependency ${key}`)
		}
		const metadata = entry[2]
		if (metadata === undefined) continue
		if (!isPlainRecord(metadata)) fail(`invalid package metadata ${key}`)
		for (const group of dependencyGroups) {
			const dependencies = metadata[group]
			if (dependencies === undefined) continue
			if (!isPlainRecord(dependencies)) fail(`invalid dependencies for ${key}`)
			for (const dependency of Object.keys(dependencies)) {
				const parents = inspectedParents[dependency]
				if (parents !== undefined && !parents.includes(key)) fail(`unexpected legacy path ${key} > ${dependency}`)
			}
		}
	}
	for (const [workspace, manifest] of Object.entries(workspaces)) {
		if (!isPlainRecord(manifest)) fail(`invalid workspace ${workspace}`)
		for (const group of dependencyGroups) {
			const dependencies = manifest[group]
			if (dependencies === undefined) continue
			if (!isPlainRecord(dependencies)) fail(`invalid workspace dependencies ${workspace}`)
			for (const dependency of Object.keys(dependencies)) {
				if (dependency in inspectedPackages) fail(`direct workspace dependency ${workspace} > ${dependency}`)
			}
		}
	}
}

if (import.meta.main) {
	const lockfile = Bun.JSONC.parse(readFileSync(path.join(repositoryRoot, 'bun.lock'), 'utf8'))
	validateLegacyZodAuditScope(lockfile)
	validatePicomatchAuditScope(lockfile)
	const child = Bun.spawn([process.execPath, 'audit', ...acceptedAuditAdvisories.map(advisory => `--ignore=${advisory}`)], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
	process.exit(await child.exited)
}

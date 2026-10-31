import { readFileSync } from 'node:fs'
import path from 'node:path'
import { acceptedAuditAdvisories } from './projects.ts'
import { repositoryRoot } from './root.mts'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
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

export function validateLegacyZodAuditScope(lockfile: unknown): void {
	if (!isRecord(lockfile)) fail('invalid workspace lockfile')
	const packages = lockfile['packages']
	const workspaces = lockfile['workspaces']
	if (!isRecord(packages) || !isRecord(workspaces)) fail('invalid workspace lockfile')
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
		if (!isRecord(metadata)) fail(`invalid package metadata ${key}`)
		for (const group of dependencyGroups) {
			const dependencies = metadata[group]
			if (dependencies === undefined) continue
			if (!isRecord(dependencies)) fail(`invalid dependencies for ${key}`)
			for (const dependency of Object.keys(dependencies)) {
				const parents = inspectedParents[dependency]
				if (parents !== undefined && !parents.includes(key)) fail(`unexpected legacy path ${key} > ${dependency}`)
			}
		}
	}
	for (const [workspace, manifest] of Object.entries(workspaces)) {
		if (!isRecord(manifest)) fail(`invalid workspace ${workspace}`)
		for (const group of dependencyGroups) {
			const dependencies = manifest[group]
			if (dependencies === undefined) continue
			if (!isRecord(dependencies)) fail(`invalid workspace dependencies ${workspace}`)
			for (const dependency of Object.keys(dependencies)) {
				if (dependency in inspectedPackages) fail(`direct workspace dependency ${workspace} > ${dependency}`)
			}
		}
	}
}

if (import.meta.main) {
	validateLegacyZodAuditScope(Bun.JSONC.parse(readFileSync(path.join(repositoryRoot, 'bun.lock'), 'utf8')))
	const child = Bun.spawn([process.execPath, 'audit', ...acceptedAuditAdvisories.map(advisory => `--ignore=${advisory}`)], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
	process.exit(await child.exited)
}

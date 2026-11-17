import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

const reviewedPackages: Readonly<Record<string, string>> = {
	picomatch: '4.0.7',
	'micromatch/picomatch': '2.3.2',
	fdir: '6.5.0',
	knip: '6.17.1',
	tinyglobby: '0.2.17',
	unplugin: '3.3.0',
	vite: '8.3.3',
	vitest: '4.1.12',
	micromatch: '4.0.8',
}
const reviewedParents: Readonly<Record<string, readonly string[]>> = {
	picomatch: ['fdir', 'knip', 'tinyglobby', 'unplugin', 'vite', 'vitest', 'micromatch'],
	fdir: ['knip', 'tinyglobby'],
	knip: [],
	tinyglobby: ['knip', 'vite', 'vitest'],
	unplugin: ['@tevm/unplugin'],
	vite: ['@vitest/mocker', 'unplugin', 'vitest'],
	vitest: ['@tevm/memory-client'],
	micromatch: ['findup-sync'],
}
const dependencyGroups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

function fail(reason: string): never {
	throw new Error(`Picomatch audit exception requires review: ${reason}`)
}

/** Restrict the unpatched advisory exception to the inspected tooling copies. */
export function validatePicomatchAuditScope(lockfile: unknown): void {
	if (!isPlainRecord(lockfile) || !isPlainRecord(lockfile['packages']) || !isPlainRecord(lockfile['workspaces'])) fail('invalid workspace lockfile')
	const packages = lockfile['packages']
	const workspaces = lockfile['workspaces']
	for (const [key, entry] of Object.entries(packages)) {
		if (!Array.isArray(entry) || typeof entry[0] !== 'string') fail(`invalid package entry ${key}`)
		if (entry[0].startsWith('picomatch@') && !(Object.hasOwn(reviewedPackages, key) && entry[0] === `picomatch@${reviewedPackages[key]}`)) fail(`unreviewed copy ${key}`)
	}
	for (const [key, version] of Object.entries(reviewedPackages)) {
		const entry = packages[key]
		const name = key === 'micromatch/picomatch' ? 'picomatch' : key
		if (!Array.isArray(entry) || entry[0] !== `${name}@${version}`) fail(`inspected package ${key} changed`)
	}
	for (const [key, entry] of Object.entries(packages)) {
		if (!Array.isArray(entry)) fail(`invalid package entry ${key}`)
		const metadata = entry[2]
		if (metadata === undefined) continue
		if (!isPlainRecord(metadata)) fail(`invalid metadata ${key}`)
		for (const group of dependencyGroups) {
			const dependencies = metadata[group]
			if (dependencies === undefined) continue
			if (!isPlainRecord(dependencies)) fail(`invalid dependencies ${key}`)
			for (const dependency of Object.keys(dependencies)) {
				const parents = Object.hasOwn(reviewedParents, dependency) ? reviewedParents[dependency] : undefined
				if (parents !== undefined && !parents.includes(key)) fail(`unexpected caller ${key} > ${dependency}`)
			}
		}
	}
	for (const [workspace, manifest] of Object.entries(workspaces)) {
		if (!isPlainRecord(manifest)) fail(`invalid workspace ${workspace}`)
		for (const group of dependencyGroups) {
			const dependencies = manifest[group]
			if (dependencies === undefined) continue
			if (!isPlainRecord(dependencies)) fail(`invalid workspace dependencies ${workspace}`)
			for (const name of Object.keys(dependencies)) {
				if (Object.hasOwn(reviewedPackages, name) && !(name === 'knip' && group === 'devDependencies')) fail(`direct workspace dependency ${workspace} > ${name}`)
			}
		}
	}
}

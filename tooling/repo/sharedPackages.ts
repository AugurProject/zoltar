export const sharedPackages = [
	{ id: 'shared-core', path: 'shared/core', name: '@zoltar/core-shared', dependencies: [] },
	{ id: 'shared-zoltar', path: 'shared/zoltar', name: '@zoltar/zoltar-shared', dependencies: ['shared-core'] },
	{ id: 'shared-open-oracle', path: 'shared/openOracle', name: '@zoltar/open-oracle-shared', dependencies: ['shared-core'] },
	{ id: 'shared-statoblast', path: 'shared/statoblast', name: '@zoltar/statoblast-shared', dependencies: ['shared-core', 'shared-zoltar', 'shared-open-oracle'] },
	{ id: 'shared-trading', path: 'shared/trading', name: '@zoltar/trading-shared', dependencies: ['shared-core', 'shared-statoblast'] },
] as const

export function sharedPackageClosure(ids: readonly string[]) {
	const selected = new Set(ids)
	for (const entry of [...sharedPackages].reverse()) {
		if (selected.has(entry.id)) for (const dependency of entry.dependencies) selected.add(dependency)
	}
	return sharedPackages.filter(entry => selected.has(entry.id))
}

export const appSharedPackages = {
	zoltar: ['shared-zoltar'],
	statoblast: ['shared-statoblast'],
	trading: ['shared-trading'],
} as const

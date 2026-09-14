import { execFileSync } from 'node:child_process'

const customChecks = [
	'tooling/repo/lint-no-bare-catch.mts',
	'tooling/repo/lint-no-signal-wrapper-comparisons.mts',
	'tooling/repo/lint-no-restricted-import-types.mts',
	'tooling/contracts/lint-no-nested-solidity-ternaries.mts',
	'tooling/ui/lint-ui-layer-boundaries.mts',
	'tooling/repo/check-shared-boundaries.mts',
] as const

export function getStaticCheckCommands(changedFiles?: readonly string[]): string[][] {
	// Type-aware and package-boundary rules need their full source graph. Keep
	// the same rules as CI whenever source, dependencies, or configuration change.
	if (changedFiles !== undefined && !changedFiles.some(file => /\.(?:[cm]?[jt]sx?|sol|json|jsonc|lock)$/.test(file))) return []
	return customChecks.map(file => ['bun', file])
}

export function runStaticChecks(changedFiles?: readonly string[]) {
	for (const [command, ...args] of getStaticCheckCommands(changedFiles)) {
		if (command === undefined) throw new Error('Static check command is missing')
		execFileSync(command, args, { stdio: 'inherit' })
	}
}

if (import.meta.main) runStaticChecks()

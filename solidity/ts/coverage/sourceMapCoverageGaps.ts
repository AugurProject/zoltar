interface KnownSourceMapCoverageGapContext {
	readonly maxPreviousLines: number
	readonly linePattern: RegExp
}

export interface KnownSourceMapCoverageGapLineRule {
	readonly currentSourceMatches: number
	readonly linePattern: RegExp
	readonly precededBy?: KnownSourceMapCoverageGapContext
}

interface KnownSourceMapCoverageGapFileRule {
	readonly sourcePath: string
	readonly lineRules: readonly KnownSourceMapCoverageGapLineRule[]
}

// Source-map ranges with adjacent executed PCs but no traceable PC for the line itself.
export const knownSourceMapCoverageGaps = [
	{
		sourcePath: 'solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol',
		lineRules: [{ currentSourceMatches: 0, linePattern: /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*_[A-Za-z_][A-Za-z0-9_]*;$/ }],
	},
	{
		sourcePath: 'solidity/contracts/peripherals/tokens/ERC1155.sol',
		lineRules: [
			{ currentSourceMatches: 1, linePattern: /^return\s+[A-Za-z_][A-Za-z0-9_]*;$/ },
			{ currentSourceMatches: 2, linePattern: /^_transferFrom\s*\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*''\s*\);$/ },
		],
	},
	{
		sourcePath: 'solidity/contracts/peripherals/EscalationGameSettlement.sol',
		lineRules: [
			{
				currentSourceMatches: 3,
				linePattern: /^require\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*!=\s*BinaryOutcomes\.BinaryOutcome\.None,\s*'No outcome'\s*\);$/,
				precededBy: {
					maxPreviousLines: 8,
					linePattern: /^uint256\s+[A-Za-z_][A-Za-z0-9_]*Index,?$/,
				},
			},
		],
	},
	{
		sourcePath: 'solidity/contracts/peripherals/EscalationGameCarry.sol',
		lineRules: [
			{ currentSourceMatches: 1, linePattern: /^if\s*\([A-Za-z_][A-Za-z0-9_]*\s*!=\s*bytes32\(0\)\)\s*return\s+[A-Za-z_][A-Za-z0-9_]*;$/ },
			{ currentSourceMatches: 1, linePattern: /^require\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\.length\s*==\s*NULLIFIER_DEPTH,\s*'Bad nullifier length'\s*\);$/ },
			{ currentSourceMatches: 1, linePattern: /^bytes32\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*_getCurrentNullifierRoot\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\);$/ },
			{ currentSourceMatches: 1, linePattern: /^require\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*==\s*[A-Za-z_][A-Za-z0-9_]*,\s*'Bad nullifier proof'\s*\);$/ },
			{ currentSourceMatches: 1, linePattern: /^if\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*>\s*inheritedAmountToConsume\s*\)\s*\{$/ },
		],
	},
] satisfies readonly KnownSourceMapCoverageGapFileRule[]

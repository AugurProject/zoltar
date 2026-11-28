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
		sourcePath: 'solidity/contracts/statoblast/tokens/ERC1155.sol',
		lineRules: [{ currentSourceMatches: 1, linePattern: /^return\s+[A-Za-z_][A-Za-z0-9_]*;$/ }],
	},
	{
		sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol',
		lineRules: [
			{
				currentSourceMatches: 1,
				linePattern: /^require\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*!=\s*BinaryOutcomes\.BinaryOutcome\.None,\s*'No outcome'\s*\);$/,
				precededBy: {
					maxPreviousLines: 8,
					linePattern: /^(?:uint256\s+[A-Za-z_][A-Za-z0-9_]*Index,?|function\s+[A-Za-z_][A-Za-z0-9_]*\([^)]*uint256\s+[A-Za-z_][A-Za-z0-9_]*Index,)/,
				},
			},
		],
	},
] satisfies readonly KnownSourceMapCoverageGapFileRule[]

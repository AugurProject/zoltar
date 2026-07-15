import { expect, test } from 'bun:test'
import { getBiomeChangedFiles } from './check-changed.mts'

test('check-changed keeps the review contract and filters unsupported config paths', () => {
	const biomeChangedFiles = getBiomeChangedFiles(['.codex/agents/reviewer.toml', '.codex/review-contract.md', 'bunfig.toml', 'solidity/contracts/peripherals/WETH9.sol', 'ui/ts/App.tsx', 'scripts/check-changed.mts'])

	expect(biomeChangedFiles).toEqual(['.codex/review-contract.md', 'ui/ts/App.tsx', 'scripts/check-changed.mts'])
})

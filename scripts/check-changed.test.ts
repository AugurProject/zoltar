import { expect, test } from 'bun:test'
import { getBiomeChangedFiles } from './check-changed.mts'

test('check-changed filters out solidity-only paths before invoking biome', () => {
	const biomeChangedFiles = getBiomeChangedFiles(['.codex/agents/reviewer.toml', 'bunfig.toml', 'solidity/contracts/peripherals/WETH9.sol', 'ui/ts/App.tsx', 'scripts/check-changed.mts'])

	expect(biomeChangedFiles).toEqual(['ui/ts/App.tsx', 'scripts/check-changed.mts'])
})

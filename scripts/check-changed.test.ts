import { expect, test } from 'bun:test'
import { getBiomeChangedFiles } from './check-changed.mts'

<<<<<<< HEAD
test('check-changed keeps UI apps and the review contract while filtering unsupported config paths', () => {
	const biomeChangedFiles = getBiomeChangedFiles(['.codex/agents/reviewer.toml', '.codex/review-contract.md', 'bunfig.toml', 'solidity/contracts/peripherals/WETH9.sol', 'ui/zoltar/ts/app/App.tsx', 'ui/trading/ts/app/App.tsx', 'ui/trading/css/app.css', 'scripts/check-changed.mts'])
=======
test('check-changed keeps the review contract and filters unsupported config paths', () => {
	const biomeChangedFiles = getBiomeChangedFiles(['.codex/agents/reviewer.toml', '.codex/review-contract.md', 'bunfig.toml', 'solidity/contracts/statoblast/WETH9.sol', 'ui/ts/app/App.tsx', 'scripts/check-changed.mts'])
>>>>>>> origin/main

	expect(biomeChangedFiles).toEqual(['.codex/review-contract.md', 'ui/zoltar/ts/app/App.tsx', 'ui/trading/ts/app/App.tsx', 'ui/trading/css/app.css', 'scripts/check-changed.mts'])
})

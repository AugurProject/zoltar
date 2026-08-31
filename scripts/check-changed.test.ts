import { expect, test } from 'bun:test'
import { getBiomeChangedFiles } from './check-changed.mts'

test('check-changed keeps Biome-supported source files while filtering prose and unsupported config paths', () => {
	const biomeChangedFiles = getBiomeChangedFiles([
		'.codex/agents/reviewer.toml',
		'.codex/review-contract.md',
		'AGENTS.md',
		'README.md',
		'bunfig.toml',
		'docs/explanation/fees.html',
		'solidity/contracts/statoblast/WETH9.sol',
		'ui/AGENTS.md',
		'ui/zoltar/ts/app/App.tsx',
		'ui/trading/ts/app/App.tsx',
		'ui/trading/css/app.css',
		'scripts/check-changed.mts',
	])

	expect(biomeChangedFiles).toEqual(['docs/explanation/fees.html', 'ui/zoltar/ts/app/App.tsx', 'ui/trading/ts/app/App.tsx', 'ui/trading/css/app.css', 'scripts/check-changed.mts'])
})

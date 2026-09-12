import { expect, test } from 'bun:test'
import { getBiomeChangedFiles } from './check-changed.mts'

test('check-changed keeps Biome-supported file types and leaves scope decisions to biome.json', () => {
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
		'tooling/repo/check-changed.mts',
	])

	expect(biomeChangedFiles).toEqual(['docs/explanation/fees.html', 'ui/zoltar/ts/app/App.tsx', 'ui/trading/ts/app/App.tsx', 'ui/trading/css/app.css', 'tooling/repo/check-changed.mts'])
})

test('check-changed passes every Biome file type through and leaves generated-path exclusions to biome.json', () => {
	const paths = ['ui/zoltarShared/ts/features/universes/components/ForkZoltarSection.tsx', 'ui/trading/scripts/browser-qa.mts', 'shared/trading/tsconfig.json', 'bots/shared/src/ethereum.ts', 'docs/assets/js/docsData.js']
	expect(getBiomeChangedFiles(paths)).toEqual(paths)
})

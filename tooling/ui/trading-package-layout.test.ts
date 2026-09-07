import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

test('keeps trading protocol code in the existing shared and solidity packages', () => {
	expect(existsSync('trading')).toBe(false)
	expect(existsSync('solidity/contracts/trading/TwoWayConstantProductRouter.sol')).toBe(true)
	expect(existsSync('shared/ts/trading/math.ts')).toBe(true)

	const tradingUiPackage = readFileSync('ui/trading/package.json', 'utf8')
	const tradingUiTsconfig = readFileSync('ui/trading/tsconfig.json', 'utf8')
	expect(tradingUiPackage).not.toContain('@zoltar/trading')
	expect(tradingUiTsconfig).not.toContain('@zoltar/trading')
})

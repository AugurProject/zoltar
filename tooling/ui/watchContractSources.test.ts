import { expect, test } from 'bun:test'
import * as path from 'node:path'
import { isWatchedContractSource } from './watchContractSources.mts'

const repositoryRoot = path.resolve('/checkout')
const contractPath = (source: string) => path.join(repositoryRoot, 'solidity', 'contracts', source)

test('contract edit and rename paths respect application dependency boundaries', () => {
	for (const source of ['statoblast/SecurityPool.sol', 'statoblast/openOracle/OpenOracle.sol', 'trading/Pair.sol', 'test/Mock.sol']) {
		expect(isWatchedContractSource(contractPath(source), repositoryRoot, 'zoltar')).toBe(false)
	}
	for (const source of ['Zoltar.sol', 'statoblast/WETH9.sol', 'statoblast/Multicall3.sol']) {
		expect(isWatchedContractSource(contractPath(source), repositoryRoot, 'zoltar')).toBe(true)
	}
	expect(isWatchedContractSource(contractPath('trading/Pair.sol'), repositoryRoot, 'statoblast')).toBe(false)
	expect(isWatchedContractSource(contractPath('statoblast/openOracle/OpenOracle.sol'), repositoryRoot, 'statoblast')).toBe(true)
	expect(isWatchedContractSource(contractPath('trading/Pair.sol'), repositoryRoot, 'trading')).toBe(true)
})

test('directory renames retain neutral infrastructure without including downstream-only directories', () => {
	for (const source of ['trading', 'statoblast/openOracle', 'test', 'chaos']) expect(isWatchedContractSource(contractPath(source), repositoryRoot, 'zoltar')).toBe(false)
	for (const source of ['', 'statoblast', 'vendor']) expect(isWatchedContractSource(contractPath(source), repositoryRoot, 'zoltar')).toBe(true)
	expect(isWatchedContractSource(contractPath('trading'), repositoryRoot, 'statoblast')).toBe(false)
})

import { expect, test } from 'bun:test'
import { statoblast_openOracle_OpenOracle_OpenOracle, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed } from '../../../../solidity/ts/types/contractArtifact'
import { openOracleAbi, openOracleArbitrageExecutorAbi, sharedPoolPriceFeedAbi } from '#contracts/abi'

test('generated OpenOracle and coordinator ABIs are the compiled artifact ABIs', () => {
	expect(openOracleAbi).toEqual(statoblast_openOracle_OpenOracle_OpenOracle.abi)
	expect(sharedPoolPriceFeedAbi).toEqual(statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi)
})

test('executor ABI pins the public executor surface of the compiled artifact', () => {
	const functionNames = openOracleArbitrageExecutorAbi.filter(entry => entry.type === 'function').map(entry => entry.name)
	expect(functionNames).toEqual(['assertParentBlock', 'contributions', 'dispute', 'hedgeAndDispute', 'settleAndWithdraw', 'unlockCallback', 'withdrawReplacementCredit'])
})

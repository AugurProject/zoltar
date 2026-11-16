import { expect, test } from 'bun:test'
import { statoblast_openOracle_OpenOracle_OpenOracle, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '../../../../solidity/ts/types/contractArtifact'
import { openOracleAbi, openOracleArbitrageExecutorAbi, openOraclePriceCoordinatorAbi } from '#contracts/abi'

test('generated OpenOracle and coordinator ABIs are the compiled artifact ABIs', () => {
	expect(openOracleAbi).toEqual(statoblast_openOracle_OpenOracle_OpenOracle.abi)
	expect(openOraclePriceCoordinatorAbi).toEqual(statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi)
})

test('executor ABI pins the public executor surface of the compiled artifact', () => {
	const functionNames = openOracleArbitrageExecutorAbi.filter(entry => entry.type === 'function').map(entry => entry.name)
	expect(functionNames).toEqual(['assertParentBlock', 'contributions', 'dispute', 'hedgeAndDispute', 'settleAndWithdraw', 'unlockCallback', 'withdrawReplacementCredit'])
})

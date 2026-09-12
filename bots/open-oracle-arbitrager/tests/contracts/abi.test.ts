import { expect, test } from 'bun:test'
import { executorArtifact } from '#contracts/artifacts.generated'
import { statoblast_openOracle_OpenOracle_OpenOracle, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '../../../../solidity/ts/types/contractArtifact'
import { openOracleAbi, openOracleArbitrageExecutorAbi, openOraclePriceCoordinatorAbi } from '#contracts/abi'

type AbiInput = {
	components?: readonly AbiInput[]
	name?: string
	type: string
}

function inputShape(input: AbiInput): AbiInput {
	return {
		...(input.components === undefined ? {} : { components: input.components.map(inputShape) }),
		...(input.name === undefined ? {} : { name: input.name }),
		type: input.type,
	}
}

test('generated OpenOracle and coordinator ABIs are the compiled artifact ABIs', () => {
	expect(openOracleAbi).toEqual(statoblast_openOracle_OpenOracle_OpenOracle.abi)
	expect(openOraclePriceCoordinatorAbi).toEqual(statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi)
})

test('executor ABI pins the public executor surface of the compiled artifact', () => {
	const functionNames = openOracleArbitrageExecutorAbi.filter(entry => entry.type === 'function').map(entry => entry.name)
	expect(functionNames).toEqual(['assertParentBlock', 'contributions', 'dispute', 'hedgeAndDispute', 'settleAndWithdraw', 'unlockCallback', 'withdrawReplacementCredit'])
	expect(
		executorArtifact.abi
			.filter(entry => entry.type === 'function')
			.map(entry => entry.name)
			.sort(),
	).toEqual([...functionNames].sort())
})

test('executor exposes atomic entry and lifecycle functions', () => {
	for (const functionName of ['hedgeAndDispute', 'settleAndWithdraw']) {
		const custom = openOracleArbitrageExecutorAbi.find(entry => entry.type === 'function' && entry.name === functionName)
		const compiled = executorArtifact.abi.find(entry => entry.type === 'function' && entry.name === functionName)
		const customInputs: readonly AbiInput[] | undefined = custom?.type === 'function' ? custom.inputs.map(inputShape) : undefined
		const compiledInputs: readonly AbiInput[] | undefined = compiled?.type === 'function' ? compiled.inputs.map(inputShape) : undefined
		expect(customInputs).toEqual(compiledInputs)
	}
})

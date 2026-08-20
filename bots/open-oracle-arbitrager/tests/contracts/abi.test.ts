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

test('custom dispute ABI matches the compiled OpenOracle contract', () => {
	const customDispute = openOracleAbi.find(entry => entry.type === 'function' && entry.name === 'dispute')
	const compiledDispute = statoblast_openOracle_OpenOracle_OpenOracle.abi.find(entry => entry.type === 'function' && entry.name === 'dispute')
	expect(customDispute?.inputs.map(inputShape)).toEqual(compiledDispute?.inputs.map(inputShape))
})

test('custom lifecycle ABI matches the compiled OpenOracle contract', () => {
	for (const functionName of ['disputeHistory', 'storedGame', 'storedHelper', 'tokenHolder', 'internalAllowance', 'settle', 'withdraw']) {
		const custom = openOracleAbi.find(entry => entry.type === 'function' && entry.name === functionName)
		const compiled = statoblast_openOracle_OpenOracle_OpenOracle.abi.find(entry => entry.type === 'function' && entry.name === functionName)
		if (custom === undefined || custom.type !== 'function' || compiled === undefined || compiled.type !== 'function') throw new Error(`Lifecycle ABI is missing ${functionName}`)
		const customInputs: readonly AbiInput[] = custom.inputs.map(inputShape)
		const compiledInputs: readonly AbiInput[] = compiled.inputs.map(inputShape)
		const customOutputs: readonly AbiInput[] = custom.outputs.map(inputShape)
		const compiledOutputs: readonly AbiInput[] = compiled.outputs.map(inputShape)
		expect(customInputs).toEqual(compiledInputs)
		expect(customOutputs).toEqual(compiledOutputs)
	}
})

test('custom executor ABI matches the compiled arbitrage executor contract', () => {
	const customDispute = openOracleArbitrageExecutorAbi.find(entry => entry.type === 'function' && entry.name === 'dispute')
	const compiledDispute = executorArtifact.abi.find(entry => entry.type === 'function' && entry.name === 'dispute')
	const customInputs: readonly AbiInput[] | undefined = customDispute?.inputs.map(inputShape)
	const compiledInputs: readonly AbiInput[] | undefined = compiledDispute?.inputs.map(inputShape)
	expect(customInputs).toEqual(compiledInputs)
})

test('custom executor ABI covers every public executor function', () => {
	const functionNames = openOracleArbitrageExecutorAbi.filter(entry => entry.type === 'function').map(entry => entry.name)
	expect(functionNames).toEqual(['assertParentBlock', 'contributions', 'dispute', 'hedgeAndDispute', 'settleAndWithdraw', 'unlockCallback', 'withdrawReplacementCredit'])
	for (const functionName of functionNames) {
		const custom = openOracleArbitrageExecutorAbi.find(entry => entry.type === 'function' && entry.name === functionName)
		const compiled = executorArtifact.abi.find(entry => entry.type === 'function' && entry.name === functionName)
		if (custom === undefined || custom.type !== 'function' || compiled === undefined || compiled.type !== 'function') throw new Error(`Executor ABI is missing ${functionName}`)
		expect(custom.inputs.map(inputShape)).toEqual(compiled.inputs.map(inputShape))
		expect(custom.outputs.map(inputShape)).toEqual(compiled.outputs.map(inputShape))
	}
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

test('custom coordinator getter ABI matches the compiled coordinator contract', () => {
	for (const custom of openOraclePriceCoordinatorAbi) {
		const compiled = statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi.find(entry => entry.type === 'function' && entry.name === custom.name)
		if (compiled === undefined || compiled.type !== 'function') throw new Error(`Compiled coordinator ABI is missing ${custom.name}`)
		expect(compiled.inputs.map(inputShape)).toEqual(custom.inputs.map(inputShape))
		expect(compiled.outputs.map(inputShape)).toEqual(custom.outputs.map(inputShape))
	}
})

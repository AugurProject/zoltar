import { expect, test } from 'bun:test'
import { peripherals_openOracle_OpenOracle_OpenOracle, peripherals_OpenOracleArbitrageExecutor_OpenOracleArbitrageExecutor } from '../solidity/ts/types/contractArtifact'
import { openOracleAbi, openOracleArbitrageExecutorAbi } from './abi.js'

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
	const compiledDispute = peripherals_openOracle_OpenOracle_OpenOracle.abi.find(entry => entry.type === 'function' && entry.name === 'dispute')
	expect(customDispute?.inputs.map(inputShape)).toEqual(compiledDispute?.inputs.map(inputShape))
})

test('custom executor ABI matches the compiled arbitrage executor contract', () => {
	const customDispute = openOracleArbitrageExecutorAbi.find(entry => entry.type === 'function' && entry.name === 'dispute')
	const compiledDispute = peripherals_OpenOracleArbitrageExecutor_OpenOracleArbitrageExecutor.abi.find(entry => entry.type === 'function' && entry.name === 'dispute')
	const customInputs: readonly AbiInput[] | undefined = customDispute?.inputs.map(inputShape)
	const compiledInputs: readonly AbiInput[] | undefined = compiledDispute?.inputs.map(inputShape)
	expect(customInputs).toEqual(compiledInputs)
})

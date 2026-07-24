import { expect, test } from 'bun:test'
import { peripherals_openOracle_OpenOracle_OpenOracle } from '../solidity/ts/types/contractArtifact'
import { openOracleAbi } from './abi.js'

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

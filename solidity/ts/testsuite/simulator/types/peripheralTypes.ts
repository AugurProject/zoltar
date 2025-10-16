
import * as funtypes from 'funtypes'
export type ContractDefinition = funtypes.Static<typeof ContractDefinition>
export const ContractDefinition = funtypes.ReadonlyObject({
	abi: funtypes.Unknown,
	evm: funtypes.ReadonlyObject({
		bytecode: funtypes.ReadonlyObject({
			object: funtypes.String
		}),
		deployedBytecode: funtypes.ReadonlyObject({
			object: funtypes.String
		})
	})
})

export type ContractInfo = {
	filename: string
	name: string
	contractDefinition: ContractDefinition
}

export enum QuestionOutcome {
	Invalid,
	Yes,
	No,
	None
}

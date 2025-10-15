
import * as funtypes from 'funtypes'
import { promises as fs } from 'fs'

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

export type ContractArtifact = funtypes.Static<typeof ContractArtifact>
export const ContractArtifact = funtypes.ReadonlyObject({
	contracts: funtypes.ReadonlyObject({
		'contracts/peripherals/openOracle/OpenOracle.sol': funtypes.ReadonlyObject({
			OpenOracle: ContractDefinition
		}),
		'contracts/peripherals/SecurityPool.sol': funtypes.ReadonlyObject({
			SecurityPoolFactory: ContractDefinition,
			SecurityPool: ContractDefinition,
			PriceOracleManagerAndOperatorQueuer: ContractDefinition
		}),
		'contracts/peripherals/CompleteSet.sol': funtypes.ReadonlyObject({
			CompleteSet: ContractDefinition,
		}),
		'contracts/peripherals/Auction.sol': funtypes.ReadonlyObject({
			Auction: ContractDefinition,
		}),
		'contracts/ReputationToken.sol': funtypes.ReadonlyObject({
			ReputationToken: ContractDefinition,
		}),
		'contracts/Zoltar.sol': funtypes.ReadonlyObject({
			Zoltar: ContractDefinition,
		}),
		'contracts/IWeth9.sol': funtypes.ReadonlyObject({
			IWeth9: ContractDefinition,
		}),
		'contracts/IAugur.sol': funtypes.ReadonlyObject({
			IAugur: ContractDefinition,
		}),
		'contracts/IERC20.sol': funtypes.ReadonlyObject({
			IERC20: ContractDefinition,
		}),
	}),
})

const contractLocation = './artifacts/Contracts.json'
export const contractsArtifact = ContractArtifact.parse(JSON.parse(await fs.readFile(contractLocation, 'utf8')))

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


import { Abi, decodeEventLog } from 'viem'
import { ContractInfo, contractsArtifact, ContractDefinition } from '../types/peripheralTypes.js'
import { ReadClient } from './viem.js'

const extractContractInfoFromArtifact = (contractArtifact: { contracts: Record<string, Record<string, ContractDefinition>> }): ContractInfo[] => {
	const contractInfoArray: ContractInfo[] = []
	for (const filename in contractArtifact.contracts) {
		const contractsInFile = contractArtifact.contracts[filename]
		for (const contractName in contractsInFile) {
			const contractDefinition = contractsInFile[contractName]
			contractInfoArray.push({ filename, name: contractName, contractDefinition })
		}
	}
	return contractInfoArray
}

export type Deployment = {
	definitionFilename: string
	deploymentName: string
	contractName: string
	address: `0x${ string }`
}

function extractContractsFromArtifact(deployments: Deployment[]) {
	const contractDefs = extractContractInfoFromArtifact(contractsArtifact)
	return deployments.map((deployment) => {
		const definition = contractDefs.find((def) => deployment.definitionFilename === def.filename && deployment.contractName === def.name)
		if (definition === undefined) throw new Error(`defintion not found for the deployment: ${ deployment.definitionFilename }`)
		return {
			definitionFilename: deployment.definitionFilename,
			contractName: deployment.contractName,
			deploymentName: deployment.deploymentName,
			address: deployment.address,
			abi: definition.contractDefinition.abi
		}
	})
}

export const printLogs = async (client: ReadClient, deployments: Deployment[]) => {
	const contracts = extractContractsFromArtifact(deployments)

	const latestBlockNumber = await client.getBlockNumber()
	const fromBlock = latestBlockNumber - 10n
	const toBlock = latestBlockNumber
	const addresses = contracts.map((contract) => contract.address)
	const rawLogs = await client.getLogs({ address: addresses, fromBlock, toBlock })
	if (rawLogs.length === 0) {
		console.log('No logs found in the last 10 blocks.')
		return
	}
	const decodedLogs: {
		blockNumber: bigint
		logIndex: number
		contractName: string
		eventName: string
		args: Record<string, unknown>
	}[] = []

	for (const log of rawLogs) {
		const contract = contracts.find((c) => c.address.toLowerCase() === log.address.toLowerCase())
		if (!contract) throw new Error(`contract not found: ${ log.address.toLowerCase() }`)

		try {
			const decoded: any = decodeEventLog({ abi: contract.abi as Abi[], data: log.data, topics: log.topics })
			decodedLogs.push({
				blockNumber: log.blockNumber,
				logIndex: log.logIndex,
				contractName: contract.deploymentName,
				eventName: decoded.eventName,
				args: decoded.args
			})
		} catch {
			throw new Error(`Failed to decode log from contract address ${ log.address.toLowerCase() }: ${ log.data }, ${ log.topics }`)
		}
	}

	// Sort logs chronologically
	decodedLogs.sort((a, b) => {
		if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex
		return a.blockNumber < b.blockNumber ? -1 : 1
	})

	// Print all logs
	for (const log of decodedLogs) {
		console.log(`\n[Block ${ log.blockNumber }] ${ log.contractName } - ${ log.eventName }`)
		console.log('Parameters:')
		for (const [paramName, paramValue] of Object.entries(log.args)) {
			console.log(`  - ${ paramName }: ${ paramValue }`)
		}
	}
}


import { Abi, decodeEventLog, GetLogsReturnType } from 'viem'
import { isUnknownAnAddress } from './utilities.js'
import { EthereumAddressString } from '../types/types.js'

export type Deployment = {
	deploymentName: string
	abi: Abi | undefined
	address: EthereumAddressString
}

interface DecodedLog {
	eventName: string
	args: Record<string, unknown> | undefined
}

function safeDecodeEventLog(parameters: { abi: Abi; data: EthereumAddressString; topics: [EthereumAddressString, ...EthereumAddressString[]] | [] }): DecodedLog | undefined {
	try {
		const result = decodeEventLog(parameters) as unknown
		if (typeof result === 'object' && result !== null && 'eventName' in result && 'args' in result) return result as DecodedLog
		return undefined
	} catch {
		return undefined
	}
}

export const printLogs = (rawLogs: GetLogsReturnType, deployments: Deployment[]) => {
	if (rawLogs.length === 0) return
	const padding = '  '
	const decodedLogs = []

	for (const log of rawLogs) {
		const contract = deployments.find((c) => BigInt(c.address) === BigInt(log.address))
		if (contract === undefined) {
			decodedLogs.push({
				blockNumber: log.blockNumber,
				logIndex: log.logIndex,
				contractName: log.address.toLowerCase(),
				eventName: log.data,
				args: log.topics.reduce((recordAccumulator, currentValue, currentIndex) => {
					recordAccumulator[`topic${ currentIndex }`] = currentValue
					return recordAccumulator
				}, {} as Record<string, unknown>)
			})
			continue
		}
		if (contract.abi === undefined) {
			console.log(`${ padding }Failed to decode log from contract address ${ log.address.toLowerCase() }: ${ log.data }, ${ log.topics } (no ABI)`)
			continue
		}
		const decoded = safeDecodeEventLog({ abi: contract.abi, data: log.data, topics: log.topics })
		if (decoded === undefined) {
			console.log(`${ padding }Failed to decode log from contract address ${ log.address.toLowerCase() }: ${ log.data }, ${ log.topics }`)
			continue
		}
		decodedLogs.push({ blockNumber: log.blockNumber, logIndex: log.logIndex, contractName: contract.deploymentName, eventName: decoded.eventName, args: decoded.args })
	}

	// Sort logs chronologically
	decodedLogs.sort((a, b) => {
		if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex
		return a.blockNumber < b.blockNumber ? -1 : 1
	})

	// Print all logs
	for (const log of decodedLogs) {
		const head = `${ log.contractName }: ${ log.eventName }`
		if (log.args === undefined) {
			console.log(`${ padding }${ head }()`)
			continue
		} else {
			console.log(`${ padding }${ head }(`)
			for (const [paramName, paramValue] of Object.entries(log.args)) {
				let formattedValue = paramValue
				if (isUnknownAnAddress(paramValue)) {
					const matchingDeployment = deployments.find((deploymentItem) => deploymentItem.address.toLowerCase() === paramValue.toLowerCase())
					if (matchingDeployment) {
						formattedValue = `${ matchingDeployment.deploymentName } (${ paramValue })`
					}
				}
				console.log(`${ padding } ${ paramName } = ${ formattedValue }`)
			}
			console.log(`${ padding })`)
		}
	}
}

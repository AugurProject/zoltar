
import { Abi, decodeEventLog, GetLogsReturnType } from 'viem'

export type Deployment = {
	deploymentName: string
	abi: Abi
	address: `0x${ string }`
}

interface DecodedLog {
	eventName: string
	args: Record<string, unknown> | undefined
}

function safeDecodeEventLog(parameters: { abi: Abi; data: `0x${string}`; topics: [`0x${string}`, ...`0x${string}`[]] | [] }): DecodedLog | undefined {
	try {
		const result = decodeEventLog(parameters) as unknown
		if (typeof result === 'object' && result !== null && 'eventName' in result && 'args' in result) return result as DecodedLog
		return undefined
	} catch {
		return undefined
	}
}

export const printLogs = async (rawLogs: GetLogsReturnType, deployments: Deployment[]) => {
	if (rawLogs.length === 0) return
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
		const decoded = safeDecodeEventLog({ abi: contract.abi, data: log.data, topics: log.topics })
		if (decoded === undefined) {
			console.log(`Failed to decode log from contract address ${ log.address.toLowerCase() }: ${ log.data }, ${ log.topics }`)
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
			console.log(`${ head }()\n`)
			continue
		} else {
			console.log(`${ head }(`)
			for (const [paramName, paramValue] of Object.entries(log.args)) {
				let formattedValue = paramValue
				if (typeof paramValue === 'string' && /^0x[a-fA-F0-9]{40}$/.test(paramValue)) {
					const matchingDeployment = deployments.find((deploymentItem) => deploymentItem.address.toLowerCase() === paramValue.toLowerCase())
					if (matchingDeployment) {
						formattedValue = `${ matchingDeployment.deploymentName } (${ paramValue })`
					}
				}
				console.log(` ${ paramName } = ${ formattedValue }`)
			}
			console.log(`)\n`)
		}
	}
}

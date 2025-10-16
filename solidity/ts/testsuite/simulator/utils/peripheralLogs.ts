
import { Abi, decodeEventLog, GetLogsReturnType } from 'viem'

export type Deployment = {
	deploymentName: string
	abi: Abi
	address: `0x${ string }`
}

export const printLogs = async (rawLogs: GetLogsReturnType, deployments: Deployment[]) => {
	if (rawLogs.length === 0) return
	const decodedLogs: {
		blockNumber: bigint
		logIndex: number
		contractName: string
		eventName: string
		args: Record<string, unknown>
	}[] = []

	for (const log of rawLogs) {
		const contract = deployments.find((c) => c.address.toLowerCase() === log.address.toLowerCase())
		if (!contract) {
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
		try {
			const decoded: any = decodeEventLog({ abi: contract.abi, data: log.data, topics: log.topics })
			console.log(decoded)
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
		console.log(`${ log.contractName }: ${ log.eventName }(`)
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

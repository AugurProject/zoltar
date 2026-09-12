import { useEffect, useState } from 'preact/hooks'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { LiveTradingControllerServices } from './liveTradingTypes.js'

export function parsedUniverseId(selectedUniverseId: string | undefined) {
	if (selectedUniverseId === undefined) return undefined
	try {
		return BigInt(selectedUniverseId)
	} catch (error) {
		if (error instanceof SyntaxError) return undefined
		throw error
	}
}

function initialQuestionClockTimestamp(simulationTimestamp: bigint | undefined, currentWallMilliseconds = Date.now()) {
	return simulationTimestamp ?? BigInt(Math.floor(currentWallMilliseconds / 1_000))
}

function questionClockShouldPollAgain(endTime: bigint | undefined, currentTimestamp: bigint) {
	return endTime === undefined || currentTimestamp < endTime
}

export function useQuestionClock(endTime: bigint | undefined, configuration: DeploymentConfiguration | undefined, services: LiveTradingControllerServices) {
	const [nowSeconds, setNowSeconds] = useState(() => initialQuestionClockTimestamp(getActiveSimulationController()?.currentTimestamp))

	useEffect(() => {
		const simulationController = getActiveSimulationController()
		if (simulationController !== undefined) {
			const update = () => setNowSeconds(simulationController.currentTimestamp)
			update()
			return simulationController.subscribe(update)
		}
		if (configuration === undefined) return
		const client = services.createTradingPublicClient(configuration)
		let timeout: ReturnType<typeof setTimeout> | undefined
		let active = true
		const updateFromChain = async () => {
			if (!active) return
			let pollAgain = true
			try {
				const block = await client.getBlock()
				if (!active) return
				setNowSeconds(block.timestamp)
				pollAgain = questionClockShouldPollAgain(endTime, block.timestamp)
			} catch (error) {
				void error
			} finally {
				if (active && pollAgain) timeout = setTimeout(() => void updateFromChain(), 12_000)
			}
		}
		void updateFromChain()
		return () => {
			active = false
			if (timeout !== undefined) clearTimeout(timeout)
		}
	}, [configuration, endTime, services])

	return nowSeconds
}

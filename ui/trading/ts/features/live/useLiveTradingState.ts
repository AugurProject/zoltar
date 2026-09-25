import { useEffect, useState } from 'preact/hooks'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { appBlockWatcher, blockPollIntervalMilliseconds } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
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

/**
 * The chain clock of the live routes. Its block read is the application's block poller: it pauses in a hidden tab, and
 * each new block refreshes the visible markets. The simulation announces its own changes, which poll immediately.
 */
export function useQuestionClock(configuration: DeploymentConfiguration | undefined, services: LiveTradingControllerServices) {
	const [nowSeconds, setNowSeconds] = useState(() => initialQuestionClockTimestamp(getActiveSimulationController()?.currentTimestamp))

	useEffect(() => {
		const simulationController = getActiveSimulationController()
		const unsubscribeSimulation = simulationController?.subscribe(() => {
			setNowSeconds(simulationController.currentTimestamp)
			void appBlockWatcher.refresh()
		})
		if (simulationController !== undefined) setNowSeconds(simulationController.currentTimestamp)
		if (configuration === undefined) return unsubscribeSimulation
		const client = services.createTradingPublicClient(configuration)
		const stopWatcher = appBlockWatcher.start(
			async () => {
				const block = await client.getBlock()
				if (simulationController === undefined) setNowSeconds(block.timestamp)
				return block.number ?? undefined
			},
			blockPollIntervalMilliseconds(simulationController !== undefined),
		)
		return () => {
			stopWatcher()
			unsubscribeSimulation?.()
		}
	}, [configuration, services])

	return nowSeconds
}

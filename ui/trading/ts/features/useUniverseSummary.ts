import { useEffect, useState } from 'preact/hooks'
import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { loadZoltarUniverseSummary } from '@zoltar/ui-zoltar-shared/protocol/zoltar.js'
import * as appCopy from '../copy/app.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { createTradingPublicClient, publicErrorMessage } from '../protocol/live.js'

export type LoadUniverseSummary = (configuration: DeploymentConfiguration, universeId: bigint) => Promise<ZoltarUniverseSummary | undefined>

export const loadUniverseSummary: LoadUniverseSummary = async (configuration, universeId) => await loadZoltarUniverseSummary(createTradingPublicClient(configuration), universeId, configuration.zoltar)

export type UniverseSummaryState = Readonly<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; universe: ZoltarUniverseSummary | undefined } | { kind: 'error'; message: string }>

/** Loads one universe summary (lineage, fork state, children) for the universe route and the header switcher. */
export function useUniverseSummary(configuration: DeploymentConfiguration | undefined, universeId: bigint | undefined, loadUniverse: LoadUniverseSummary = loadUniverseSummary) {
	const [state, setState] = useState<UniverseSummaryState>({ kind: 'idle' })
	const [retryNonce, setRetryNonce] = useState(0)
	useEffect(() => {
		if (configuration === undefined || universeId === undefined) {
			setState({ kind: 'idle' })
			return
		}
		let active = true
		setState({ kind: 'loading' })
		void (async () => {
			try {
				const universe = await withReadTimeout(loadUniverse(configuration, universeId))
				if (active) setState({ kind: 'ready', universe })
			} catch (error) {
				if (active) setState({ kind: 'error', message: publicErrorMessage(error, appCopy.universeUnavailable) })
			}
		})()
		return () => {
			active = false
		}
	}, [configuration, loadUniverse, retryNonce, universeId])
	return { retry: () => setRetryNonce(current => current + 1), state }
}

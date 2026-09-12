import { extname } from 'node:path'
import type { NetworkName } from '../monitoring/connectivity.ts'

type ProfileProcessMode = { once: boolean; ui: boolean; uiHost: string; uiPort: number }

export function chainSpecificPath(path: string, network: NetworkName) {
	const extension = extname(path)
	const stem = (extension === '' ? path : path.slice(0, -extension.length)).replace(/\.(?:mainnet|sepolia)$/, '')
	return `${stem}.${network}${extension}`
}

export function assertCompatibleProfileProcessMode(current: { runtime: ProfileProcessMode }, target: { runtime: ProfileProcessMode }) {
	if (current.runtime.once !== target.runtime.once || current.runtime.ui !== target.runtime.ui || current.runtime.uiHost !== target.runtime.uiHost || current.runtime.uiPort !== target.runtime.uiPort) {
		throw new Error('Chain profiles must use the same once mode and dashboard binding to switch in place')
	}
}

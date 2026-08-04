export * from '@zoltar/bot-shared/monitoring/connectivity'

import { validateConnectivitySettings, validateIndependentReadRpcUrls, type ConnectivitySettings } from '@zoltar/bot-shared/monitoring/connectivity'

export function validateConnectivitySettingsForQuorum(value: unknown, quorumRpcUrls: readonly string[]): ConnectivitySettings {
	const connectivity = validateConnectivitySettings(value)
	validateIndependentReadRpcUrls(connectivity.readRpcUrl, quorumRpcUrls)
	return connectivity
}

import { deploymentFactoryId, executionProfileId } from '../config/execution-profile.ts'
import { DEPLOYMENT_PIN_ADDRESS_KEYS, parseDeploymentPinAddresses, parseSettings, serializedSettings, type OperatorSettings } from '../config/settings.ts'
import { dashboardRecord as record, exactDashboardKeys as exactKeys } from './dashboard-input.ts'

/** Derived deployment identities are regenerated on save; the editor owns the addresses, not their hashes. */
export function editableSettings(settings: OperatorSettings) {
	const serialized = serializedSettings(settings, true)
	const { privateKey: _privateKey, ...publicSettings } = serialized
	const { profileId: _profileId, factoryId: _factoryId, ...deploymentPin } = serialized.deploymentPin
	return { ...publicSettings, deploymentPin }
}

export function completeSettingsCandidate(current: OperatorSettings, value: unknown) {
	const body = record(value, 'Complete configuration update')
	exactKeys(body, ['settings', 'revision'], 'Complete configuration update')
	const settings = record(body['settings'], 'settings')
	if ('privateKey' in settings) throw new Error('Use the Transaction signer control to change private keys')
	const runtime = record(settings['runtime'], 'runtime')
	const pausedSettings = { ...settings, privateKey: current.privateKey ?? null, paused: true, runtime: { ...runtime, execute: false } }
	const base = parseSettings({ ...pausedSettings, deploymentPin: undefined }, current.privateKey)
	const pin = settings['deploymentPin']
	if (pin === undefined) return { revision: body['revision'], settings: base }
	const addresses = record(pin, 'deploymentPin')
	exactKeys(addresses, DEPLOYMENT_PIN_ADDRESS_KEYS, 'deploymentPin')
	const deployment = parseDeploymentPinAddresses(addresses)
	const profileId = executionProfileId({ network: base.network, deployment })
	return {
		revision: body['revision'],
		settings: parseSettings({ ...pausedSettings, deploymentPin: { ...deployment, profileId, factoryId: deploymentFactoryId(profileId, deployment.uniswapV3Factory) } }, current.privateKey),
	}
}

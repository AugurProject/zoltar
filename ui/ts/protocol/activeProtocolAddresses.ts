import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'

export function getGenesisReputationTokenAddress() {
	return getActiveNetworkProfile().genesisRepTokenAddress
}

export function getWethAddress() {
	return getActiveNetworkProfile().wethAddress
}

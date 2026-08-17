import { getRuntimeNetworkProfile } from '../lib/networkProfile.js'

export function getGenesisReputationTokenAddress() {
	return getRuntimeNetworkProfile().genesisRepTokenAddress
}

export function getWethAddress() {
	return getRuntimeNetworkProfile().wethAddress
}

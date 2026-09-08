import { getRuntimeNetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

export function getGenesisReputationTokenAddress() {
	return getRuntimeNetworkProfile().genesisRepTokenAddress
}

export function getWethAddress() {
	return getRuntimeNetworkProfile().wethAddress
}

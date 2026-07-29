import { getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { MAINNET_PROTOCOL_TOKEN_ADDRESSES, getInfraContractAddresses as deriveInfraContractAddresses, getZoltarAddress as deriveZoltarAddress } from './deploymentHelpers.js'

function getActiveProtocolTokenAddresses() {
	const profile = getActiveNetworkProfile()
	if (profile.id === 'simulation') return MAINNET_PROTOCOL_TOKEN_ADDRESSES
	return {
		genesisRepTokenAddress: profile.genesisRepTokenAddress,
		wethAddress: profile.wethAddress,
	}
}

export function getInfraContractAddresses() {
	return deriveInfraContractAddresses(getActiveProtocolTokenAddresses())
}

export function getZoltarAddress() {
	return deriveZoltarAddress(getActiveProtocolTokenAddresses())
}

export function getOpenOracleAddress() {
	return getInfraContractAddresses().openOracle
}

export function getMulticall3Address() {
	return getInfraContractAddresses().multicall3
}

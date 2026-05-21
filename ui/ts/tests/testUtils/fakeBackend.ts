import type { Address } from 'viem'
import type { ChainBackend } from '../../lib/chainBackend.js'
import { MAINNET_NETWORK_PROFILE, createSimulationProfile, type NetworkProfile } from '../../lib/networkProfile.js'

type FakeBackendOptions = {
	accountAddress?: Address
	currentTimestamp?: bigint
	hasWallet?: boolean
	profile?: NetworkProfile
}

export function createFakeBackend({ accountAddress, currentTimestamp, hasWallet = true, profile = MAINNET_NETWORK_PROFILE }: FakeBackendOptions = {}): ChainBackend {
	const accounts = accountAddress === undefined ? [] : [accountAddress]

	return {
		bootstrapError: undefined,
		bootstrapLabel: undefined,
		bootstrapProgress: undefined,
		createReadClient: () => {
			throw new Error('Fake backend read client should not be used in this test')
		},
		createWriteClient: () => {
			throw new Error('Fake backend write client should not be used in this test')
		},
		...(currentTimestamp === undefined ? {} : { currentTimestamp }),
		getAccounts: async () => accounts,
		getChainId: async () => profile.chainIdHex,
		getProvider: () => undefined,
		hasWallet: () => hasWallet,
		id: profile.id === 'simulation' ? 'simulation' : 'injected',
		profile,
		requestAccounts: async () => accounts,
		subscribe: undefined,
		subscribeAccountsChanged: () => () => undefined,
		subscribeChainChanged: () => () => undefined,
	}
}

export function createFakeSimulationProfile() {
	return createSimulationProfile({
		genesisRepTokenAddress: '0x00000000000000000000000000000000000000d1',
		wethAddress: '0x00000000000000000000000000000000000000d2',
	})
}

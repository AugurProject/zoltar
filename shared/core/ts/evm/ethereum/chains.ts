import { getAddress } from './encoding.js'

import { type Chain, type Hash } from './types.js'

import { amounts } from 'micro-eth-signer'

export const zeroAddress = getAddress('0x0000000000000000000000000000000000000000')

export const zeroHash = `0x${'00'.repeat(32)}` satisfies Hash

export const maxUint256 = amounts.maxUint256

const MAINNET_CHAIN = {
	id: 1,
	name: 'Ethereum',
	nativeCurrency: {
		decimals: 18,
		name: 'Ether',
		symbol: 'ETH',
	},
	rpcUrls: {
		default: {
			http: ['https://ethereum-rpc.publicnode.com'],
		},
	},
} satisfies Chain

export const mainnet = MAINNET_CHAIN

export function defineChain<TChain extends Chain>(chain: TChain) {
	return chain
}

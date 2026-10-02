import { getAddress } from './encoding.js'

import { type Chain, type Hash } from './types.js'

import { amounts } from 'micro-eth-signer'

export const zeroAddress = getAddress('0x0000000000000000000000000000000000000000')

export const zeroHash = `0x${'00'.repeat(32)}` satisfies Hash

export const maxUint256 = amounts.maxUint256

const MAINNET_CHAIN = {
	id: 1,
	name: 'Ethereum mainnet',
	nativeCurrency: {
		decimals: 18,
		name: 'Ether',
		symbol: 'ETH',
	},
	rpcUrls: {
		default: {
			http: ['https://ethereum.dark.florist'],
		},
	},
	blockExplorers: {
		default: {
			name: 'Etherscan',
			url: 'https://etherscan.io',
		},
	},
} satisfies Chain

const SEPOLIA_CHAIN = {
	id: 11155111,
	name: 'Sepolia',
	nativeCurrency: {
		decimals: 18,
		name: 'Sepolia Ether',
		symbol: 'ETH',
	},
	rpcUrls: {
		default: {
			http: ['https://ethereum-sepolia-rpc.publicnode.com'],
		},
	},
	blockExplorers: {
		default: {
			name: 'Etherscan',
			url: 'https://sepolia.etherscan.io',
		},
	},
} satisfies Chain

export const mainnet = MAINNET_CHAIN

export const sepolia = SEPOLIA_CHAIN

/** Returns the default block explorer URL of a shared chain definition, or `undefined` for chains without one. */
export function blockExplorerUrl(chainId: number) {
	return [mainnet, sepolia].find(chain => chain.id === chainId)?.blockExplorers.default.url
}

export function defineChain<TChain extends Chain>(chain: TChain) {
	return chain
}

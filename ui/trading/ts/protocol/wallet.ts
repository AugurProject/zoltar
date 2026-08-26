import { bigintToSafeNumber } from '../lib/format.js'
import { readInjectedChainId, requireInjectedAccount, switchInjectedChain } from '@zoltar/ui-core-shared/injectedEthereum.js'
import type { InjectedEthereum } from './injected.js'

export async function connectWallet(provider: InjectedEthereum) {
	return await requireInjectedAccount(provider, 'eth_requestAccounts')
}

export async function connectedWalletAccount(provider: InjectedEthereum) {
	return await requireInjectedAccount(provider)
}

export async function walletChainId(provider: InjectedEthereum) {
	return bigintToSafeNumber(BigInt(await readInjectedChainId(provider)), 'Wallet chain ID')
}

export async function switchWalletChain(provider: InjectedEthereum, chainId: number) {
	await switchInjectedChain(provider, `0x${chainId.toString(16)}`)
}

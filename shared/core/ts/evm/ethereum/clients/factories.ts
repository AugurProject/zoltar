import { type Account, type Address, type Chain, type ExtendableClient, type PublicClient, type Transport, type WalletClient } from '../types.js'

import { buildPublicClientActions, buildRpcTransactionRequest, isAlreadyKnownTransactionError } from './actions.js'

import { getAddress, keccak256, normalizeHash, normalizeRpcHex } from '../encoding.js'

import { requestTransport, requestTransportWithRateLimitRetries } from '../transport.js'

import { encodeFunctionData } from '../abi.js'

// Each extended client gets its own `extend` closing over the extended client, so chained extensions accumulate.
function attachExtend<TClient extends object>(client: TClient): TClient & ExtendableClient {
	const extended: TClient & ExtendableClient = { ...client, extend: extension => attachExtend({ ...extended, ...extension(extended) }) }
	return extended
}

export function createPublicClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ chain, transport }: { chain?: TChain; transport: TTransport }): PublicClient<TTransport, TChain> {
	const resolvedChain = chain as TChain
	const actions = buildPublicClientActions({
		chain: resolvedChain,
		transport,
	})
	const client: Omit<PublicClient<TTransport, TChain>, 'extend'> = { ...actions, chain: resolvedChain, transport }
	return attachExtend(client)
}

function normalizeWalletAccount(account: Account | Address | undefined) {
	if (account === undefined) return undefined
	if (typeof account === 'string') {
		return {
			address: getAddress(account),
			type: 'json-rpc',
		} satisfies Account
	}
	return account
}

export function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: { account: Account | Address; chain?: TChain; transport: TTransport }): WalletClient<TTransport, TChain, Account>

export function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: { account?: undefined; chain?: TChain; transport: TTransport }): WalletClient<TTransport, TChain, undefined>

export function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: { account?: Account | Address | undefined; chain?: TChain; transport: TTransport }) {
	const normalizedAccount = normalizeWalletAccount(account)
	const publicClient =
		chain === undefined
			? createPublicClient({
					transport,
				})
			: createPublicClient({
					chain,
					transport,
				})
	const baseClient = publicClient as PublicClient<TTransport, TChain>
	const walletActions: Omit<WalletClient<TTransport, TChain, Account | undefined>, 'extend'> = {
		...baseClient,
		account: normalizedAccount,
		call: async parameters => {
			const account = parameters.account ?? normalizedAccount
			const data = normalizeRpcHex(
				await requestTransportWithRateLimitRetries<string>(transport, {
					method: 'eth_call',
					params: [
						buildRpcTransactionRequest({
							account,
							data: parameters.data,
							gas: parameters.gas,
							gasPrice: parameters.gasPrice,
							maxFeePerGas: parameters.maxFeePerGas,
							maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
							to: parameters.to,
							value: parameters.value,
						}),
						'latest',
					],
				}),
			)
			return {
				data,
			}
		},
		estimateContractGas: async parameters =>
			await baseClient.estimateContractGas({
				...parameters,
				account: parameters.account ?? normalizedAccount,
			}),
		sendRawTransaction: async parameters => {
			const expectedHash = keccak256(parameters.serializedTransaction)
			try {
				const returnedHash = normalizeHash(
					await requestTransportWithRateLimitRetries<string>(transport, {
						method: 'eth_sendRawTransaction',
						params: [parameters.serializedTransaction],
					}),
				)
				if (returnedHash !== expectedHash) throw new Error(`RPC returned transaction hash ${returnedHash}, which does not match submitted transaction ${expectedHash}`)
				return expectedHash
			} catch (error) {
				if (!isAlreadyKnownTransactionError(error)) throw error
				return expectedHash
			}
		},
		simulateContract: async parameters =>
			await baseClient.simulateContract({
				...parameters,
				account: parameters.account ?? normalizedAccount,
			}),
		sendTransaction: async parameters => {
			const sender = parameters.account ?? normalizedAccount
			if (typeof sender === 'object' && sender !== null && sender.type === 'local' && sender.signTransaction !== undefined) {
				const hasMaxFeePerGas = parameters.maxFeePerGas !== undefined
				const hasMaxPriorityFeePerGas = parameters.maxPriorityFeePerGas !== undefined
				if (hasMaxFeePerGas !== hasMaxPriorityFeePerGas) throw new Error('Local EIP-1559 transactions require both maxFeePerGas and maxPriorityFeePerGas')
				const value = parameters.value ?? parameters.amount
				const [preparedChainId, preparedGas, preparedNonce, preparedGasPrice] = await Promise.all([
					chain?.id ?? baseClient.getChainId(),
					parameters.gas ??
						baseClient.estimateGas({
							account: sender,
							data: parameters.data,
							gasPrice: parameters.gasPrice,
							maxFeePerGas: parameters.maxFeePerGas,
							maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
							to: parameters.to ?? undefined,
							value,
						}),
					parameters.nonce ?? baseClient.getTransactionCount({ address: sender.address, blockTag: 'pending' }),
					parameters.gasPrice ?? (hasMaxFeePerGas ? undefined : baseClient.getGasPrice()),
				])
				const serializedTransaction = await sender.signTransaction({
					chainId: preparedChainId,
					data: parameters.data,
					gas: preparedGas,
					gasPrice: preparedGasPrice,
					maxFeePerGas: parameters.maxFeePerGas,
					maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
					nonce: preparedNonce,
					to: parameters.to ?? undefined,
					value,
				})
				return await walletActions.sendRawTransaction({
					serializedTransaction,
				})
			}

			const normalizedSender = (() => {
				if (sender === undefined) return undefined
				if (typeof sender === 'string') return getAddress(sender)
				return sender
			})()
			return normalizeHash(
				await requestTransport<string>(transport, {
					method: 'eth_sendTransaction',
					params: [
						buildRpcTransactionRequest({
							account: normalizedSender,
							amount: parameters.amount,
							data: parameters.data,
							gas: parameters.gas,
							gasPrice: parameters.gasPrice,
							maxFeePerGas: parameters.maxFeePerGas,
							maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
							nonce: parameters.nonce,
							to: parameters.to,
							value: parameters.value,
						}),
					],
				}),
			)
		},
		writeContract: async parameters =>
			await walletActions.sendTransaction({
				account: parameters.account,
				data: encodeFunctionData({
					abi: parameters.abi,
					...(parameters.args === undefined ? {} : { args: parameters.args }),
					functionName: parameters.functionName,
				}),
				gas: parameters.gas,
				gasPrice: parameters.gasPrice,
				maxFeePerGas: parameters.maxFeePerGas,
				maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
				to: parameters.address,
				value: parameters.value,
			}),
	}
	return attachExtend(walletActions)
}

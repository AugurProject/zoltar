import { bytesToHex as nobleBytesToHex } from '@noble/hashes/utils.js'
import { bigintToSafeNumber, ensure0x, hexQuantity, normalizeBlockTag, transactionCountBlockTag, normalizeHash, normalizeRpcHex, normalizeRpcBigInt, normalizeCodecArguments, getNamedFunctionAbi, getContractMethod, decodeFunctionOutput, encodeEventTopics, encodeFunctionData, decodeEventLog, getAddress } from './codec'
import type {
	Hex,
	Address,
	Hash,
	AbiParameter,
	Abi,
	ContractFunctionResult,
	RpcLogForEvent,
	ContractReadParameters,
	ContractSimulateParameters,
	ContractWriteParameters,
	EstimateContractGasParameters,
	ContractFunctionParameters,
	Chain,
	TransactionReceipt,
	WaitForTransactionReceiptParameters,
	BlockTransaction,
	Block,
	Account,
	Transport,
	MulticallReturnType,
	BlockTag,
	LogTopicFilter,
} from './types'
import { REPLACEMENT_SCAN_BLOCK_DEPTH, buildRpcTransactionRequest, findReplacementTransaction, getReplacementReason, isTransactionNotFoundError, normalizeBlock, normalizeLog, normalizeReceipt, normalizeTransaction } from './rpc-normalization'
import { custom, http, requestTransport, RpcError, type TransportOptions } from './rpc-transport.ts'

export { custom, http, RpcError, type TransportOptions }

type PublicClientShape<TTransport extends Transport, TChain extends Chain | undefined> = {
	chain: TChain
	extend: <TExtension extends object>(extension: (client: PublicClientShape<TTransport, TChain>) => TExtension) => PublicClientShape<TTransport, TChain> & TExtension
	estimateContractGas: <TAbi extends Abi, TFunctionName extends string>(parameters: EstimateContractGasParameters<TAbi, TFunctionName>) => Promise<bigint>
	getBalance: (parameters: { address: Address; blockTag?: BlockTag | undefined }) => Promise<bigint>
	getBlock: (parameters?: { blockNumber?: bigint | undefined; includeTransactions?: boolean | undefined }) => Promise<Block>
	getBlockNumber: () => Promise<bigint>
	getChainId: () => Promise<number>
	getCode: (parameters: { address: Address; blockTag?: BlockTag | undefined }) => Promise<Hex | undefined>
	getLogs: <TEvent extends AbiParameter | undefined>(parameters: { address?: Address | undefined; event?: TEvent; fromBlock?: bigint | undefined; toBlock?: bigint | undefined; topics?: readonly LogTopicFilter[] | undefined }) => Promise<readonly RpcLogForEvent<TEvent>[]>
	getTransaction: (parameters: { hash: Hash }) => Promise<BlockTransaction>
	getTransactionCount: (parameters: { address: Address; blockNumber?: bigint | undefined; blockTag?: BlockTag | undefined }) => Promise<bigint>
	getTransactionReceipt: (parameters: { hash: Hash }) => Promise<TransactionReceipt>
	multicall: <TContracts extends readonly ContractFunctionParameters[], TAllowFailure extends boolean>(parameters: { allowFailure: TAllowFailure; contracts: TContracts; multicallAddress: Address }) => Promise<MulticallReturnType<TContracts, TAllowFailure>>
	readContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractFunctionParameters<TAbi, TFunctionName>) => Promise<ContractFunctionResult<TAbi, TFunctionName>>
	simulateContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractSimulateParameters<TAbi, TFunctionName>) => Promise<{ result: ContractFunctionResult<TAbi, TFunctionName> }>
	transport: TTransport
	waitForTransactionReceipt: (parameters: WaitForTransactionReceiptParameters) => Promise<TransactionReceipt>
}

type WalletClientShape<TTransport extends Transport, TChain extends Chain | undefined, TAccount extends Account | undefined> = Omit<PublicClientShape<TTransport, TChain>, 'extend'> & {
	account: TAccount
	call: (parameters: { account?: Account | Address | undefined; data?: Hex | undefined; gas?: bigint | undefined; gasPrice?: bigint | undefined; maxFeePerGas?: bigint | undefined; maxPriorityFeePerGas?: bigint | undefined; to?: Address | undefined; value?: bigint | undefined }) => Promise<{ data: Hex | undefined }>
	extend: <TExtension extends object>(extension: (client: WalletClientShape<TTransport, TChain, TAccount>) => TExtension) => WalletClientShape<TTransport, TChain, TAccount> & TExtension
	sendRawTransaction: (parameters: { serializedTransaction: Hex }) => Promise<Hash>
	sendTransaction: (parameters: {
		account?: Account | Address | undefined
		amount?: bigint | undefined
		data?: Hex | undefined
		gas?: bigint | undefined
		gasPrice?: bigint | undefined
		maxFeePerGas?: bigint | undefined
		maxPriorityFeePerGas?: bigint | undefined
		nonce?: bigint | number | undefined
		to?: Address | null | undefined
		value?: bigint | undefined
	}) => Promise<Hash>
	writeContract: <TAbi extends Abi, TFunctionName extends string>(parameters: ContractWriteParameters<TAbi, TFunctionName>) => Promise<Hash>
}

export type PublicClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined> = PublicClientShape<TTransport, TChain>

export type WalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined, TAccount extends Account | undefined = Account | undefined> = WalletClientShape<TTransport, TChain, TAccount>

export type PublicActions<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined> = Omit<PublicClient<TTransport, TChain>, 'chain' | 'extend' | 'transport'>

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

const MULTICALL3_ABI = [
	{
		inputs: [
			{
				components: [
					{ name: 'target', type: 'address' },
					{ name: 'allowFailure', type: 'bool' },
					{ name: 'callData', type: 'bytes' },
				],
				name: 'calls',
				type: 'tuple[]',
			},
		],
		name: 'aggregate3',
		outputs: [
			{
				components: [
					{ name: 'success', type: 'bool' },
					{ name: 'returnData', type: 'bytes' },
				],
				name: 'returnData',
				type: 'tuple[]',
			},
		],
		stateMutability: 'payable',
		type: 'function',
	},
] as const

export const mainnet = MAINNET_CHAIN

export function defineChain<TChain extends Chain>(chain: TChain) {
	return chain
}

async function readContractRaw<TAbi extends Abi, TFunctionName extends string>(transport: Transport, parameters: ContractReadParameters<TAbi, TFunctionName>, blockNumber?: bigint | undefined) {
	const abiItem = getNamedFunctionAbi(parameters.abi, parameters.functionName, parameters.args)
	const method = getContractMethod(abiItem)
	const data = ensure0x(nobleBytesToHex(method.encodeInput(normalizeCodecArguments(abiItem.inputs, parameters.args))))
	const rawResult = normalizeRpcHex(
		await requestTransport<string>(transport, {
			method: 'eth_call',
			params: [
				buildRpcTransactionRequest({
					account: parameters.account,
					data,
					gas: parameters.gas,
					gasPrice: parameters.gasPrice,
					maxFeePerGas: parameters.maxFeePerGas,
					maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
					to: parameters.address,
					value: parameters.value,
				}),
				blockNumber === undefined ? (parameters.blockTag ?? 'latest') : normalizeBlockTag(blockNumber),
			],
		}),
	)
	if (rawResult === '0x' && (abiItem.outputs?.length ?? 0) > 0) {
		throw new RpcError(`The contract function "${parameters.functionName}" returned no data ("0x"). The contract does not have the function "${parameters.functionName}".`, {
			shortMessage: `The contract function "${parameters.functionName}" returned no data ("0x"). The contract does not have the function "${parameters.functionName}".`,
		})
	}
	return {
		abiItem,
		data: rawResult,
	}
}

export async function readContractAtBlock(transport: Transport, parameters: { abi: Abi; address: Address; args?: readonly unknown[] | undefined; functionName: string }, blockNumber: bigint): Promise<unknown> {
	const { abiItem, data } = await readContractRaw(transport, parameters, blockNumber)
	return decodeFunctionOutput(abiItem, data)
}

export async function getBalanceAtBlock(transport: Transport, parameters: { address: Address; blockNumber: bigint }) {
	return normalizeRpcBigInt(
		await requestTransport<string>(transport, {
			method: 'eth_getBalance',
			params: [parameters.address, normalizeBlockTag(parameters.blockNumber)],
		}),
	)
}

export async function getTransactionCountAtBlock(transport: Transport, parameters: { address: Address; blockNumber: bigint }) {
	return normalizeRpcBigInt(
		await requestTransport<string>(transport, {
			method: 'eth_getTransactionCount',
			params: [parameters.address, normalizeBlockTag(parameters.blockNumber)],
		}),
	)
}

function buildPublicClientActions<TTransport extends Transport, TChain extends Chain | undefined>({ chain, transport }: { chain: TChain; transport: TTransport }): Omit<PublicClientShape<TTransport, TChain>, 'chain' | 'extend' | 'transport'> {
	return {
		estimateContractGas: async <TAbi extends Abi, TFunctionName extends string>(parameters: EstimateContractGasParameters<TAbi, TFunctionName>) =>
			normalizeRpcBigInt(
				await requestTransport<string>(transport, {
					method: 'eth_estimateGas',
					params: [
						buildRpcTransactionRequest({
							account: parameters.account,
							data: encodeFunctionData({
								abi: parameters.abi,
								...(parameters.args === undefined ? {} : { args: parameters.args }),
								functionName: parameters.functionName,
							}),
							gasPrice: parameters.gasPrice,
							maxFeePerGas: parameters.maxFeePerGas,
							maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
							to: parameters.address,
							value: parameters.value,
						}),
					],
				}),
			),
		getBalance: async parameters =>
			normalizeRpcBigInt(
				await requestTransport<string>(transport, {
					method: 'eth_getBalance',
					params: [parameters.address, parameters.blockTag ?? 'latest'],
				}),
			),
		getTransactionCount: async parameters =>
			normalizeRpcBigInt(
				await requestTransport<string>(transport, {
					method: 'eth_getTransactionCount',
					params: [parameters.address, transactionCountBlockTag(parameters)],
				}),
			),
		getBlock: async parameters => {
			const includeTransactions = parameters?.includeTransactions === true
			const blockTag = normalizeBlockTag(parameters?.blockNumber)
			const block = await requestTransport<unknown>(transport, {
				method: 'eth_getBlockByNumber',
				params: [blockTag, includeTransactions],
			})
			return normalizeBlock(block, includeTransactions)
		},
		getBlockNumber: async () => normalizeRpcBigInt(await requestTransport<string>(transport, { method: 'eth_blockNumber' })),
		getChainId: async () => bigintToSafeNumber(normalizeRpcBigInt(await requestTransport<string>(transport, { method: 'eth_chainId' })), 'Chain ID'),
		getCode: async parameters => {
			const result = normalizeRpcHex(
				await requestTransport<string>(transport, {
					method: 'eth_getCode',
					params: [parameters.address, parameters.blockTag ?? 'latest'],
				}),
			)
			return result === '0x' ? undefined : result
		},
		getLogs: async <TEvent extends AbiParameter | undefined>(parameters: { address?: Address | undefined; event?: TEvent; fromBlock?: bigint | undefined; toBlock?: bigint | undefined; topics?: readonly LogTopicFilter[] | undefined }) => {
			const event = parameters.event
			if (event !== undefined && parameters.topics !== undefined) throw new Error('getLogs accepts either an event or raw topics, not both')
			const topics =
				parameters.topics ??
				(event === undefined
					? undefined
					: encodeEventTopics({
							abi: [event],
							eventName: event.name ?? 'event',
						}))
			const rawLogs = await requestTransport<unknown[]>(transport, {
				method: 'eth_getLogs',
				params: [
					{
						...(parameters.address === undefined ? {} : { address: parameters.address }),
						...(parameters.fromBlock === undefined ? {} : { fromBlock: hexQuantity(parameters.fromBlock) }),
						...(parameters.toBlock === undefined ? {} : { toBlock: hexQuantity(parameters.toBlock) }),
						...(topics === undefined ? {} : { topics }),
					},
				],
			})
			return rawLogs.map(rawLog => {
				const normalizedLog = normalizeLog(rawLog)
				if (event === undefined) return normalizedLog
				const decodedLog = decodeEventLog({
					abi: [event],
					data: normalizedLog.data,
					topics: normalizedLog.topics,
				})
				return {
					...normalizedLog,
					args: decodedLog.args,
					eventName: decodedLog.eventName,
				}
			}) as unknown as readonly RpcLogForEvent<TEvent>[]
		},
		getTransaction: async parameters => {
			const rawTransaction = await requestTransport<unknown>(transport, {
				method: 'eth_getTransactionByHash',
				params: [parameters.hash],
			})
			if (rawTransaction === null) throw new Error(`Transaction with hash "${parameters.hash}" could not be found.`)
			return normalizeTransaction(rawTransaction)
		},
		getTransactionReceipt: async parameters => {
			const rawReceipt = await requestTransport<unknown>(transport, {
				method: 'eth_getTransactionReceipt',
				params: [parameters.hash],
			})
			if (rawReceipt === null) throw new Error(`Transaction receipt with hash "${parameters.hash}" could not be found.`)
			return normalizeReceipt(rawReceipt)
		},
		multicall: async <TContracts extends readonly ContractFunctionParameters[], TAllowFailure extends boolean>(parameters: { allowFailure: TAllowFailure; contracts: TContracts; multicallAddress: Address }) => {
			const calls: { allowFailure: boolean; callData: Hex; target: Address }[] = []
			for (const contract of parameters.contracts) {
				calls.push({
					allowFailure: parameters.allowFailure,
					callData: encodeFunctionData({
						abi: contract.abi,
						...(contract.args === undefined ? {} : { args: contract.args }),
						functionName: contract.functionName,
					}),
					target: contract.address,
				})
			}
			const rawResult = (await readContractRaw(transport, {
				abi: MULTICALL3_ABI,
				address: parameters.multicallAddress,
				args: [calls] as never,
				functionName: 'aggregate3',
			})) as {
				abiItem: AbiParameter
				data: Hex
			}
			const decoded = decodeFunctionOutput(rawResult.abiItem, rawResult.data)
			if (!Array.isArray(decoded)) throw new Error('Unexpected multicall response')

			if (parameters.allowFailure) {
				return decoded.map((entry, index) => {
					if (typeof entry !== 'object' || entry === null || !('success' in entry) || !('returnData' in entry)) {
						return {
							error: new Error('Unexpected multicall response'),
							status: 'failure',
						}
					}
					if (entry.success !== true) {
						return {
							error: new Error('Multicall contract call failed'),
							status: 'failure',
						}
					}
					const contract = parameters.contracts[index]
					if (contract === undefined) throw new Error('Missing multicall contract response')
					const abiItem = getNamedFunctionAbi(contract.abi, contract.functionName, contract.args)
					return {
						result: decodeFunctionOutput(abiItem, entry.returnData as Hex),
						status: 'success',
					}
				}) as MulticallReturnType<typeof parameters.contracts, typeof parameters.allowFailure>
			}

			return decoded.map((entry, index) => {
				if (typeof entry !== 'object' || entry === null || !('success' in entry) || !('returnData' in entry) || entry.success !== true) {
					throw new Error('Multicall contract call failed')
				}
				const contract = parameters.contracts[index]
				if (contract === undefined) throw new Error('Missing multicall contract response')
				const abiItem = getNamedFunctionAbi(contract.abi, contract.functionName, contract.args)
				return decodeFunctionOutput(abiItem, entry.returnData as Hex)
			}) as MulticallReturnType<typeof parameters.contracts, typeof parameters.allowFailure>
		},
		readContract: async <TAbi extends Abi, TFunctionName extends string>(parameters: ContractFunctionParameters<TAbi, TFunctionName>) => {
			const { abiItem, data } = await readContractRaw(transport, parameters)
			return decodeFunctionOutput(abiItem, data) as ContractFunctionResult<TAbi, TFunctionName>
		},
		simulateContract: async <TAbi extends Abi, TFunctionName extends string>(parameters: ContractSimulateParameters<TAbi, TFunctionName>) => {
			const { abiItem, data } = await readContractRaw(transport, parameters)
			return {
				result: decodeFunctionOutput(abiItem, data) as ContractFunctionResult<TAbi, TFunctionName>,
			}
		},
		waitForTransactionReceipt: async parameters => {
			const timeoutMilliseconds = parameters.timeout ?? 180_000
			const pollingInterval = parameters.pollingInterval ?? 1_000
			const startTime = Date.now()
			const actions = buildPublicClientActions({ chain, transport })
			let originalTransaction = parameters.transaction
			let lastScannedReplacementBlock: bigint | undefined
			if (parameters.onReplaced !== undefined && originalTransaction === undefined) {
				try {
					originalTransaction = await actions.getTransaction({
						hash: parameters.hash,
					})
				} catch (error) {
					if (!isTransactionNotFoundError(error)) throw error
				}
			}
			while (true) {
				try {
					return await actions.getTransactionReceipt({
						hash: parameters.hash,
					})
				} catch (error) {
					if (!isTransactionNotFoundError(error)) throw error
					if (parameters.onReplaced !== undefined && originalTransaction === undefined) {
						try {
							originalTransaction = await actions.getTransaction({
								hash: parameters.hash,
							})
						} catch (transactionError) {
							if (!isTransactionNotFoundError(transactionError)) throw transactionError
						}
					}
					if (originalTransaction !== undefined) {
						const latestBlockNumber = await actions.getBlockNumber()
						let firstScanBlock = lastScannedReplacementBlock === undefined ? 0n : lastScannedReplacementBlock + 1n
						if (lastScannedReplacementBlock === undefined && latestBlockNumber > REPLACEMENT_SCAN_BLOCK_DEPTH) {
							firstScanBlock = latestBlockNumber - REPLACEMENT_SCAN_BLOCK_DEPTH
						}
						const replacementTransaction = firstScanBlock > latestBlockNumber ? undefined : await findReplacementTransaction(actions, originalTransaction, { fromBlock: firstScanBlock, toBlock: latestBlockNumber })
						lastScannedReplacementBlock = latestBlockNumber
						if (replacementTransaction !== undefined) {
							const transactionReceipt = await actions.getTransactionReceipt({
								hash: replacementTransaction.hash,
							})
							parameters.onReplaced?.({
								reason: getReplacementReason(originalTransaction, replacementTransaction),
								replacedTransaction: originalTransaction,
								transaction: replacementTransaction,
								transactionReceipt,
							})
							return transactionReceipt
						}
					}
					if (Date.now() - startTime >= timeoutMilliseconds) throw error
					await new Promise(resolve => {
						setTimeout(resolve, pollingInterval)
					})
				}
			}
		},
	}
}

function getClientDefaultAccountAddress(client: object): Address | undefined {
	if (!('account' in client)) return undefined
	const account = client.account
	if (typeof account === 'string') return getAddress(account)
	if (typeof account !== 'object' || account === null) return undefined
	if (!('address' in account) || typeof account.address !== 'string') return undefined
	return getAddress(account.address)
}

export function publicActions<TTransport extends Transport, TChain extends Chain | undefined>(client: PublicClientShape<TTransport, TChain>) {
	const actions = buildPublicClientActions({
		chain: client.chain,
		transport: client.transport,
	})
	const defaultAccount = getClientDefaultAccountAddress(client)
	if (defaultAccount === undefined) return actions
	const estimateContractGas: typeof actions.estimateContractGas = async parameters =>
		await actions.estimateContractGas({
			...parameters,
			account: parameters.account ?? defaultAccount,
		})
	const simulateContract: typeof actions.simulateContract = async parameters =>
		await actions.simulateContract({
			...parameters,
			account: parameters.account ?? defaultAccount,
		})
	return {
		...actions,
		estimateContractGas,
		simulateContract,
	}
}

export function createPublicClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ chain, transport }: { cacheTime?: number | undefined; chain?: TChain; transport: TTransport }): PublicClient<TTransport, TChain> {
	const resolvedChain = chain as TChain
	const actions = buildPublicClientActions({
		chain: resolvedChain,
		transport,
	})
	let client: PublicClient<TTransport, TChain>
	client = {
		...actions,
		chain: resolvedChain,
		extend: extension => Object.assign({}, client, extension(client)) as PublicClient<TTransport, TChain> & ReturnType<typeof extension>,
		transport,
	}
	return client
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

export function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: { account: Account | Address; cacheTime?: number | undefined; chain?: TChain; transport: TTransport }): WalletClient<TTransport, TChain, Account>
export function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: { account?: undefined; cacheTime?: number | undefined; chain?: TChain; transport: TTransport }): WalletClient<TTransport, TChain, undefined>
export function createWalletClient<TTransport extends Transport = Transport, TChain extends Chain | undefined = Chain | undefined>({ account, chain, transport }: { account?: Account | Address | undefined; cacheTime?: number | undefined; chain?: TChain; transport: TTransport }) {
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
	let walletClient: WalletClient<TTransport, TChain, Account | undefined>
	walletClient = {
		...baseClient,
		account: normalizedAccount,
		call: async parameters => {
			const account = parameters.account ?? normalizedAccount
			const data = normalizeRpcHex(
				await requestTransport<string>(transport, {
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
		sendRawTransaction: async parameters =>
			normalizeHash(
				await requestTransport<string>(transport, {
					method: 'eth_sendRawTransaction',
					params: [parameters.serializedTransaction],
				}),
			),
		simulateContract: async parameters =>
			await baseClient.simulateContract({
				...parameters,
				account: parameters.account ?? normalizedAccount,
			}),
		sendTransaction: async parameters => {
			const sender = parameters.account ?? normalizedAccount
			if (typeof sender === 'object' && sender !== null && sender.type === 'local' && sender.signTransaction !== undefined) {
				const serializedTransaction = await sender.signTransaction({
					chainId: chain?.id,
					data: parameters.data,
					gas: parameters.gas,
					gasPrice: parameters.gasPrice,
					maxFeePerGas: parameters.maxFeePerGas,
					maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
					nonce: parameters.nonce,
					to: parameters.to ?? undefined,
					value: parameters.value ?? parameters.amount,
				})
				return await walletClient.sendRawTransaction({
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
		extend: extension => Object.assign({}, walletClient, extension(walletClient)) as WalletClient<TTransport, TChain, Account | undefined> & ReturnType<typeof extension>,
		writeContract: async parameters =>
			await walletClient.sendTransaction({
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
	return walletClient
}

import { errorChain } from '../../../errors/errorChain.js'
import type {
	Abi,
	AbiParameter,
	Account,
	Address,
	BlockTag,
	Chain,
	ContractFunctionParameters,
	ContractFunctionResult,
	ContractReadParameters,
	ContractSimulateParameters,
	EstimateContractGasParameters,
	Hash,
	Hex,
	JsonValue,
	LogTopicFilter,
	MulticallReturnType,
	PublicClientActions,
	PublicClientShape,
	RpcLog,
	RpcLogForEvent,
	SendTransactionParameters,
	Transport,
} from '../types.js'

import { ContractFunctionError, RpcError } from '../errors.js'

import { bigintToSafeNumber, ensure0x, getAddress, hexQuantity, normalizeBlockTag, normalizeHash, normalizeRequiredRpcBigInt, normalizeRpcHex, requireMatchingTransactionHash } from '../encoding.js'

import { MULTICALL3_ABI, decodeEventLog, decodeFunctionOutput, encodeEventTopics, encodeFunctionData, getContractMethod, getNamedFunctionAbi, normalizeCodecArguments } from '../abi.js'

import { bytesToHex as nobleBytesToHex } from '@noble/hashes/utils.js'

import { requestTransportWithRateLimitRetries } from '../transport.js'

import { getLogAddressFilter, logMatchesTopicFilter, normalizeBlock, normalizeLog, normalizeReceipt, normalizeTransaction, snapshotLogTopicFilter } from '../rpc.js'

import { multicallFailureMessage } from '../../multicallFailure.js'
import { waitForTransactionReceipt } from './receiptWatcher.js'

export function isAlreadyKnownTransactionError(error: unknown) {
	return error instanceof RpcError && error.message.toLowerCase().includes('already known')
}

export function buildRpcTransactionRequest(parameters: SendTransactionParameters) {
	const from = normalizeAccountAddress(parameters.account)
	const value = parameters.value ?? parameters.amount
	return {
		...(from === undefined ? {} : { from }),
		...(parameters.to === undefined || parameters.to === null ? {} : { to: parameters.to }),
		...(parameters.data === undefined ? {} : { data: parameters.data }),
		...(parameters.gas === undefined ? {} : { gas: hexQuantity(parameters.gas) }),
		...(parameters.gasPrice === undefined ? {} : { gasPrice: hexQuantity(parameters.gasPrice) }),
		...(parameters.maxFeePerGas === undefined ? {} : { maxFeePerGas: hexQuantity(parameters.maxFeePerGas) }),
		...(parameters.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: hexQuantity(parameters.maxPriorityFeePerGas) }),
		...(parameters.nonce === undefined ? {} : { nonce: hexQuantity(parameters.nonce) }),
		...(value === undefined ? {} : { value: hexQuantity(value) }),
	}
}

export function rpcBalanceOverride(parameters: { account?: Account | Address | undefined; balanceOverride?: bigint | undefined }) {
	if (parameters.balanceOverride === undefined) return []
	const account = normalizeAccountAddress(parameters.account)
	if (account === undefined) throw new Error('Balance override requires a simulation account')
	return [{ [account]: { balance: hexQuantity(parameters.balanceOverride) } }]
}

function normalizeAccountAddress(account: Account | Address | undefined) {
	if (account === undefined) return undefined
	return typeof account === 'string' ? getAddress(account) : account.address
}

function resolveBlockSelector(parameters: { blockHash?: Hash | undefined; blockNumber?: bigint | undefined; blockTag?: BlockTag | undefined }) {
	const selectedBlocks = [parameters.blockHash, parameters.blockNumber, parameters.blockTag].filter(value => value !== undefined)
	if (selectedBlocks.length > 1) throw new Error('RPC reads accept only one block selector')
	if (parameters.blockHash !== undefined) return { blockHash: parameters.blockHash, requireCanonical: true } as const
	return parameters.blockTag ?? normalizeBlockTag(parameters.blockNumber)
}

function resolveBlockTag(parameters: { blockNumber?: bigint | undefined; blockTag?: BlockTag | undefined } = {}) {
	const selector = resolveBlockSelector(parameters)
	if (typeof selector !== 'string') throw new Error('RPC method requires a block number or tag')
	return selector
}

async function readContractRaw<TAbi extends Abi, TFunctionName extends string>(transport: Transport, parameters: ContractReadParameters<TAbi, TFunctionName>) {
	const blockSelector = resolveBlockSelector(parameters)
	const abiItem = getNamedFunctionAbi(parameters.abi, parameters.functionName, parameters.args)
	const method = getContractMethod(abiItem)
	const data = ensure0x(nobleBytesToHex(method.encodeInput(normalizeCodecArguments(abiItem.inputs, parameters.args))))
	let rpcResult: string
	try {
		rpcResult = await requestTransportWithRateLimitRetries<string>(transport, {
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
				blockSelector,
			],
		})
	} catch (cause) {
		for (const current of errorChain(cause)) {
			if (current instanceof RpcError && current.message.toLowerCase().includes('revert')) {
				throw new ContractFunctionError('ContractFunctionRevertedError', current.message, cause)
			}
		}
		throw cause
	}
	const rawResult = normalizeRpcHex(rpcResult)
	if (rawResult === '0x' && (abiItem.outputs?.length ?? 0) > 0) {
		throw new ContractFunctionError('ContractFunctionZeroDataError', `The contract function "${parameters.functionName}" returned no data ("0x"). The contract does not have the function "${parameters.functionName}".`)
	}
	return {
		abiItem,
		data: rawResult,
	}
}

export function buildPublicClientActions<TTransport extends Transport, TChain extends Chain | undefined>({ chain, transport }: { chain: TChain; transport: TTransport }): Omit<PublicClientShape<TTransport, TChain>, 'chain' | 'extend' | 'transport'> {
	// The overload carries the event-specific decoded argument types; the implementation decodes against the runtime ABI.
	async function getLogs<TEvent extends AbiParameter | undefined>(parameters: {
		address?: Address | readonly Address[] | undefined
		args?: Readonly<Record<string, unknown>> | undefined
		event?: TEvent
		fromBlock?: bigint | undefined
		toBlock?: bigint | undefined
		topics?: readonly LogTopicFilter[] | undefined
	}): Promise<readonly RpcLogForEvent<TEvent>[]>
	async function getLogs(parameters: { address?: Address | readonly Address[] | undefined; args?: Readonly<Record<string, unknown>> | undefined; event?: AbiParameter | undefined; fromBlock?: bigint | undefined; toBlock?: bigint | undefined; topics?: readonly LogTopicFilter[] | undefined }): Promise<readonly RpcLog[]> {
		const event = parameters.event
		if (event !== undefined && parameters.topics !== undefined) throw new Error('getLogs accepts either an event or raw topics, not both')
		const address = typeof parameters.address === 'string' || parameters.address === undefined ? parameters.address : [...parameters.address]
		const addressFilter = getLogAddressFilter(address)
		const fromBlock = parameters.fromBlock
		const toBlock = parameters.toBlock
		const topics =
			parameters.topics ??
			(event === undefined
				? undefined
				: encodeEventTopics({
						abi: [event],
						...(parameters.args === undefined ? {} : { args: parameters.args }),
						eventName: event.name ?? 'event',
					}))
		const requestedTopics = topics === undefined ? undefined : snapshotLogTopicFilter(topics)
		const requestTopics = requestedTopics === undefined ? undefined : snapshotLogTopicFilter(requestedTopics)
		const rawLogs = await requestTransportWithRateLimitRetries<readonly JsonValue[]>(transport, {
			method: 'eth_getLogs',
			params: [
				{
					...(address === undefined ? {} : { address }),
					...(fromBlock === undefined ? {} : { fromBlock: hexQuantity(fromBlock) }),
					...(toBlock === undefined ? {} : { toBlock: hexQuantity(toBlock) }),
					...(requestTopics === undefined ? {} : { topics: requestTopics }),
				},
			],
		})
		return rawLogs.map(rawLog => {
			const normalizedLog = normalizeLog(rawLog)
			if (addressFilter !== undefined && !addressFilter.has(normalizedLog.address.toLowerCase())) throw new Error('RPC returned a log outside the requested filter')
			if (fromBlock !== undefined && (normalizedLog.blockNumber === undefined || normalizedLog.blockNumber < fromBlock)) throw new Error('RPC returned a log outside the requested filter')
			if (toBlock !== undefined && (normalizedLog.blockNumber === undefined || normalizedLog.blockNumber > toBlock)) throw new Error('RPC returned a log outside the requested filter')
			if (requestedTopics !== undefined && !logMatchesTopicFilter(normalizedLog.topics, requestedTopics)) throw new Error('RPC returned a log outside the requested filter')
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
		})
	}
	const getCode: PublicClientActions['getCode'] = async parameters => {
		const result = normalizeRpcHex(
			await requestTransportWithRateLimitRetries<string>(transport, {
				method: 'eth_getCode',
				params: [parameters.address, resolveBlockTag(parameters)],
			}),
		)
		return result === '0x' ? undefined : result
	}

	return {
		estimateContractGas: async <TAbi extends Abi, TFunctionName extends string>(parameters: EstimateContractGasParameters<TAbi, TFunctionName>) =>
			normalizeRequiredRpcBigInt(
				await requestTransportWithRateLimitRetries<string>(transport, {
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
						...(parameters.blockNumber === undefined ? [] : [normalizeBlockTag(parameters.blockNumber)]),
					],
				}),
				'gas estimate',
			),
		estimateGas: async parameters =>
			normalizeRequiredRpcBigInt(
				await requestTransportWithRateLimitRetries<string>(transport, {
					method: 'eth_estimateGas',
					params: [buildRpcTransactionRequest(parameters), ...(parameters.blockNumber === undefined && parameters.balanceOverride === undefined ? [] : [normalizeBlockTag(parameters.blockNumber)]), ...rpcBalanceOverride(parameters)],
				}),
				'gas estimate',
			),
		getBalance: async parameters =>
			normalizeRequiredRpcBigInt(
				await requestTransportWithRateLimitRetries<string>(transport, {
					method: 'eth_getBalance',
					params: [parameters.address, resolveBlockTag(parameters)],
				}),
				'balance',
			),
		getBlock: async parameters => {
			const includeTransactions = parameters?.includeTransactions === true
			const blockTag = resolveBlockTag(parameters)
			const block = await requestTransportWithRateLimitRetries<JsonValue>(transport, {
				method: 'eth_getBlockByNumber',
				params: [blockTag, includeTransactions],
			})
			if (block === null) throw new RpcError('RPC block not found', { code: -32000 })
			const normalizedBlock = normalizeBlock(block, includeTransactions, blockTag === 'pending')
			if (parameters?.blockNumber !== undefined && normalizedBlock.number !== parameters.blockNumber) {
				throw new Error(`RPC returned block ${normalizedBlock.number?.toString() ?? 'without a number'}, which does not match requested block ${parameters.blockNumber.toString()}`)
			}
			return normalizedBlock
		},
		getBlockNumber: async () => normalizeRequiredRpcBigInt(await requestTransportWithRateLimitRetries<string>(transport, { method: 'eth_blockNumber' }), 'block number'),
		getChainId: async () => bigintToSafeNumber(normalizeRequiredRpcBigInt(await requestTransportWithRateLimitRetries<string>(transport, { method: 'eth_chainId' }), 'chain ID'), 'Chain ID'),
		getCode,
		getBytecode: getCode,
		getGasPrice: async () => normalizeRequiredRpcBigInt(await requestTransportWithRateLimitRetries<string>(transport, { method: 'eth_gasPrice' }), 'gas price'),
		getTransactionCount: async parameters =>
			normalizeRequiredRpcBigInt(
				await requestTransportWithRateLimitRetries<string>(transport, {
					method: 'eth_getTransactionCount',
					params: [getAddress(parameters.address), resolveBlockTag(parameters)],
				}),
				'transaction count',
			),
		getLogs,
		getTransaction: async parameters => {
			const requestedHash = normalizeHash(parameters.hash)
			const rawTransaction = await requestTransportWithRateLimitRetries<JsonValue>(transport, {
				method: 'eth_getTransactionByHash',
				params: [requestedHash],
			})
			if (rawTransaction === null) throw new Error(`Transaction with hash "${requestedHash}" could not be found.`)
			const transaction = normalizeTransaction(rawTransaction)
			requireMatchingTransactionHash(requestedHash, transaction.hash, 'transaction')
			return transaction
		},
		getTransactionReceipt: async parameters => {
			const requestedHash = normalizeHash(parameters.hash)
			const rawReceipt = await requestTransportWithRateLimitRetries<JsonValue>(transport, {
				method: 'eth_getTransactionReceipt',
				params: [requestedHash],
			})
			if (rawReceipt === null) throw new Error(`Transaction receipt with hash "${requestedHash}" could not be found.`)
			const receipt = normalizeReceipt(rawReceipt)
			requireMatchingTransactionHash(requestedHash, receipt.transactionHash, 'transaction receipt')
			return receipt
		},
		multicall: async <TContracts extends readonly ContractFunctionParameters[], TAllowFailure extends boolean>(parameters: { allowFailure: TAllowFailure; blockNumber?: bigint | undefined; contracts: TContracts; multicallAddress: Address }) => {
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
				blockNumber: parameters.blockNumber,
				functionName: 'aggregate3',
			})) as {
				abiItem: AbiParameter
				data: Hex
			}
			const decoded = decodeFunctionOutput(rawResult.abiItem, rawResult.data)
			if (!Array.isArray(decoded)) throw new Error('Unexpected multicall response')
			if (decoded.length !== parameters.contracts.length) throw new Error(`Multicall returned ${decoded.length.toString()} results for ${parameters.contracts.length.toString()} calls`)
			const decodeEntry = (index: number, returnData: Hex) => {
				const contract = parameters.contracts[index]
				if (contract === undefined) throw new Error('Missing multicall contract response')
				return decodeFunctionOutput(getNamedFunctionAbi(contract.abi, contract.functionName, contract.args), returnData)
			}

			if (parameters.allowFailure) {
				return decoded.map((entry, index) => {
					if (typeof entry !== 'object' || entry === null || !('success' in entry) || !('returnData' in entry)) return { error: new Error('Unexpected multicall response'), status: 'failure' }
					if (entry.success !== true) return { error: new Error(multicallFailureMessage(entry.returnData)), status: 'failure' }
					// A result that cannot be decoded only fails its own entry; the other results stay usable.
					try {
						return { result: decodeEntry(index, entry.returnData as Hex), status: 'success' }
					} catch (error) {
						return { error: error instanceof Error ? error : new Error('Multicall result decoding failed', { cause: error }), status: 'failure' }
					}
				}) as MulticallReturnType<typeof parameters.contracts, typeof parameters.allowFailure>
			}

			return decoded.map((entry, index) => {
				if (typeof entry !== 'object' || entry === null || !('success' in entry) || !('returnData' in entry)) throw new Error('Unexpected multicall response')
				if (entry.success !== true) throw new Error(multicallFailureMessage(entry.returnData))
				return decodeEntry(index, entry.returnData as Hex)
			}) as MulticallReturnType<typeof parameters.contracts, typeof parameters.allowFailure>
		},
		readContract: async <TAbi extends Abi, TFunctionName extends string>(parameters: ContractReadParameters<TAbi, TFunctionName>) => {
			const { abiItem, data } = await readContractRaw(transport, parameters)
			return decodeFunctionOutput(abiItem, data) as ContractFunctionResult<TAbi, TFunctionName>
		},
		simulateContract: async <TAbi extends Abi, TFunctionName extends string>(parameters: ContractSimulateParameters<TAbi, TFunctionName>) => {
			const { abiItem, data } = await readContractRaw(transport, parameters)
			return {
				result: decodeFunctionOutput(abiItem, data) as ContractFunctionResult<TAbi, TFunctionName>,
			}
		},
		waitForTransactionReceipt: parameters => waitForTransactionReceipt(buildPublicClientActions({ chain, transport: { ...transport, retryCount: 0 } }), parameters, transport.retryDelay),
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
	return withDefaultAccount(actions, getClientDefaultAccountAddress(client))
}

export function withDefaultAccount(actions: PublicClientActions, defaultAccount: Address | undefined) {
	if (defaultAccount === undefined) return actions
	const estimateGas: typeof actions.estimateGas = async parameters => await actions.estimateGas({ ...parameters, account: parameters.account ?? defaultAccount })
	const readContract: typeof actions.readContract = async parameters => await actions.readContract({ ...parameters, account: parameters.account ?? defaultAccount })
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
		estimateGas,
		readContract,
		simulateContract,
	}
}

import { errorChain } from '../../../errors/errorChain.js'
import {
	type Abi,
	type AbiParameter,
	type Account,
	type Address,
	type BlockTag,
	type BlockTransaction,
	type Chain,
	type ContractFunctionParameters,
	type ContractFunctionResult,
	type ContractReadParameters,
	type ContractSimulateParameters,
	type EstimateContractGasParameters,
	type Hash,
	type Hex,
	type JsonValue,
	type LogTopicFilter,
	type MulticallReturnType,
	type PublicClientActions,
	type PublicClientShape,
	type ReplacementReason,
	type RpcLogForEvent,
	type Transport,
} from '../types.js'

import { ContractFunctionError, RpcError } from '../errors.js'

import { bigintToSafeNumber, ensure0x, getAddress, hexQuantity, normalizeBlockTag, normalizeHash, normalizeRequiredRpcBigInt, normalizeRpcHex, requireMatchingTransactionHash } from '../encoding.js'

import { MULTICALL3_ABI, decodeEventLog, decodeFunctionOutput, encodeEventTopics, encodeFunctionData, getContractMethod, getNamedFunctionAbi, normalizeCodecArguments } from '../abi.js'

import { bytesToHex as nobleBytesToHex } from '@noble/hashes/utils.js'

import { isRateLimitError, requestTransportWithRateLimitRetries, retryRateLimited, runWithDeadline } from '../transport.js'

import { getLogAddressFilter, logMatchesTopicFilter, normalizeBlock, normalizeLog, normalizeReceipt, normalizeTransaction, snapshotLogTopicFilter } from '../rpc.js'

import { multicallFailureMessage } from '../../multicallFailure.js'

function isBlockTransaction(value: unknown): value is BlockTransaction {
	return typeof value === 'object' && value !== null && 'hash' in value && 'from' in value && 'nonce' in value
}

function isTransactionNotFoundError(error: unknown): error is Error {
	return error instanceof Error && error.message.includes('could not be found')
}

export function isAlreadyKnownTransactionError(error: unknown) {
	return error instanceof RpcError && error.message.toLowerCase().includes('already known')
}

function getReplacementReason(originalTransaction: BlockTransaction, replacementTransaction: BlockTransaction): ReplacementReason {
	if (replacementTransaction.to?.toLowerCase() === originalTransaction.from.toLowerCase() && replacementTransaction.value === 0n && replacementTransaction.input === '0x') return 'cancelled'
	if (replacementTransaction.to?.toLowerCase() === originalTransaction.to?.toLowerCase() && replacementTransaction.value === originalTransaction.value && replacementTransaction.input === originalTransaction.input) return 'repriced'
	return 'replaced'
}

const REPLACEMENT_SCAN_BLOCK_DEPTH = 12n

async function findReplacementTransaction(actions: PublicClientActions, originalTransaction: BlockTransaction, parameters: { fromBlock: bigint; toBlock: bigint }, blockReader: Pick<PublicClientActions, 'getBlock'> = actions) {
	for (let blockNumber = parameters.fromBlock; blockNumber <= parameters.toBlock; blockNumber += 1n) {
		const block = await blockReader.getBlock({
			blockNumber,
			includeTransactions: true,
		})
		const replacementTransaction = block.transactions.find((transaction): transaction is BlockTransaction => isBlockTransaction(transaction) && transaction.hash !== originalTransaction.hash && transaction.nonce === originalTransaction.nonce && transaction.from.toLowerCase() === originalTransaction.from.toLowerCase())
		if (replacementTransaction !== undefined) return replacementTransaction
	}
	return undefined
}

export function buildRpcTransactionRequest(parameters: {
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
}) {
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

function normalizeAccountAddress(account: Account | Address | undefined) {
	if (account === undefined) return undefined
	return typeof account === 'string' ? getAddress(account) : account.address
}

async function readContractRaw<TAbi extends Abi, TFunctionName extends string>(transport: Transport, parameters: ContractReadParameters<TAbi, TFunctionName>) {
	const selectedBlocks = [parameters.blockHash, parameters.blockNumber, parameters.blockTag].filter(value => value !== undefined)
	if (selectedBlocks.length > 1) throw new Error('Contract reads accept only one block selector')
	let blockSelector: BlockTag | Hex | Readonly<{ blockHash: Hash; requireCanonical: true }> = parameters.blockTag ?? 'latest'
	if (parameters.blockNumber !== undefined) blockSelector = hexQuantity(parameters.blockNumber)
	if (parameters.blockHash !== undefined) blockSelector = { blockHash: parameters.blockHash, requireCanonical: true }
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
	const getCode: PublicClientActions['getCode'] = async parameters => {
		const result = normalizeRpcHex(
			await requestTransportWithRateLimitRetries<string>(transport, {
				method: 'eth_getCode',
				params: [parameters.address, parameters.blockNumber === undefined ? (parameters.blockTag ?? 'latest') : hexQuantity(parameters.blockNumber)],
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
					],
				}),
				'gas estimate',
			),
		estimateGas: async parameters =>
			normalizeRequiredRpcBigInt(
				await requestTransportWithRateLimitRetries<string>(transport, {
					method: 'eth_estimateGas',
					params: [buildRpcTransactionRequest(parameters)],
				}),
				'gas estimate',
			),
		getBalance: async parameters =>
			normalizeRequiredRpcBigInt(
				await requestTransportWithRateLimitRetries<string>(transport, {
					method: 'eth_getBalance',
					params: [parameters.address, parameters.blockNumber === undefined ? (parameters.blockTag ?? 'latest') : hexQuantity(parameters.blockNumber)],
				}),
				'balance',
			),
		getBlock: async parameters => {
			const includeTransactions = parameters?.includeTransactions === true
			const blockTag = parameters?.blockNumber === undefined ? (parameters?.blockTag ?? 'latest') : normalizeBlockTag(parameters.blockNumber)
			const block = await requestTransportWithRateLimitRetries<JsonValue>(transport, {
				method: 'eth_getBlockByNumber',
				params: [blockTag, includeTransactions],
			})
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
					params: [getAddress(parameters.address), parameters.blockNumber === undefined ? (parameters.blockTag ?? 'latest') : hexQuantity(parameters.blockNumber)],
				}),
				'transaction count',
			),
		getLogs: async <TEvent extends AbiParameter | undefined>(parameters: { address?: Address | readonly Address[] | undefined; args?: Readonly<Record<string, unknown>> | undefined; event?: TEvent; fromBlock?: bigint | undefined; toBlock?: bigint | undefined; topics?: readonly LogTopicFilter[] | undefined }) => {
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
			}) as unknown as readonly RpcLogForEvent<TEvent>[]
		},
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
		waitForTransactionReceipt: async parameters => {
			const timeoutMilliseconds = parameters.timeout ?? 180_000
			const pollingInterval = parameters.pollingInterval ?? 1_000
			const startTime = Date.now()
			const actions = buildPublicClientActions({ chain, transport: { ...transport, retryCount: 0 } })
			let lastRateLimitError: Error | undefined
			let lastRequestError: Error | undefined
			let lastReceiptNotFoundError: Error | undefined
			return await runWithDeadline({
				getTimeoutError: () => lastRateLimitError ?? lastReceiptNotFoundError ?? lastRequestError ?? new Error(`Timed out while waiting for transaction receipt "${parameters.hash}".`),
				operation: async runBeforeDeadline => {
					const waitForNextPoll = async () => {
						let pollingTimer: ReturnType<typeof setTimeout> | undefined
						try {
							await runBeforeDeadline(
								async () =>
									await new Promise(resolve => {
										pollingTimer = setTimeout(resolve, pollingInterval)
									}),
							)
						} finally {
							if (pollingTimer !== undefined) clearTimeout(pollingTimer)
						}
					}
					const retryReceiptRateLimited = async <TValue>(operation: () => Promise<TValue>) => {
						lastRateLimitError = undefined
						lastRequestError = undefined
						return await runBeforeDeadline(
							async () =>
								await retryRateLimited(
									async () => {
										lastRateLimitError = undefined
										lastRequestError = undefined
										try {
											const result = await operation()
											lastRateLimitError = undefined
											return result
										} catch (error) {
											if (error instanceof Error) {
												lastRateLimitError = isRateLimitError(error) ? error : undefined
												lastRequestError = error
											}
											throw error
										}
									},
									{
										retryDelay: transport.retryDelay,
										startTime,
										timeout: timeoutMilliseconds,
									},
								),
						)
					}
					let originalTransaction = parameters.transaction
					let lastScannedReplacementBlock: bigint | undefined
					if (parameters.onReplaced !== undefined && originalTransaction === undefined) {
						try {
							originalTransaction = await retryReceiptRateLimited(
								async () =>
									await actions.getTransaction({
										hash: parameters.hash,
									}),
							)
						} catch (error) {
							if (!isTransactionNotFoundError(error)) throw error
						}
					}
					while (true) {
						try {
							return await retryReceiptRateLimited(
								async () =>
									await actions.getTransactionReceipt({
										hash: parameters.hash,
									}),
							)
						} catch (error) {
							if (!isTransactionNotFoundError(error)) throw error
							lastReceiptNotFoundError = error
							if (parameters.onReplaced !== undefined && originalTransaction === undefined) {
								try {
									originalTransaction = await retryReceiptRateLimited(
										async () =>
											await actions.getTransaction({
												hash: parameters.hash,
											}),
									)
								} catch (transactionError) {
									if (!isTransactionNotFoundError(transactionError)) throw transactionError
								}
							}
							if (originalTransaction !== undefined) {
								const transactionToReplace = originalTransaction
								const latestBlockNumber = await retryReceiptRateLimited(async () => await actions.getBlockNumber())
								let firstScanBlock = lastScannedReplacementBlock === undefined ? 0n : lastScannedReplacementBlock + 1n
								if (latestBlockNumber > REPLACEMENT_SCAN_BLOCK_DEPTH && firstScanBlock < latestBlockNumber - REPLACEMENT_SCAN_BLOCK_DEPTH) {
									firstScanBlock = latestBlockNumber - REPLACEMENT_SCAN_BLOCK_DEPTH
								}
								const replacementBlockReader: Pick<PublicClientActions, 'getBlock'> = {
									getBlock: async parameters => await retryReceiptRateLimited(async () => await actions.getBlock(parameters)),
								}
								const replacementTransaction = firstScanBlock > latestBlockNumber ? undefined : await findReplacementTransaction(actions, transactionToReplace, { fromBlock: firstScanBlock, toBlock: latestBlockNumber }, replacementBlockReader)
								lastScannedReplacementBlock = latestBlockNumber
								if (replacementTransaction !== undefined) {
									const transactionReceipt = await retryReceiptRateLimited(
										async () =>
											await actions.getTransactionReceipt({
												hash: replacementTransaction.hash,
											}),
									)
									parameters.onReplaced?.({
										reason: getReplacementReason(transactionToReplace, replacementTransaction),
										replacedTransaction: transactionToReplace,
										transaction: replacementTransaction,
										transactionReceipt,
									})
									return transactionReceipt
								}
							}
							if (Date.now() - startTime >= timeoutMilliseconds) throw error
							await waitForNextPoll()
						}
					}
				},
				timeout: timeoutMilliseconds,
			})
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

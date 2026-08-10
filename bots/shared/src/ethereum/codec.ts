import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex as nobleBytesToHex, concatBytes, hexToBytes as nobleHexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { addr, amounts, eip191Signer, Transaction } from 'micro-eth-signer'
import { Decoder, createContract, deployContract, events } from 'micro-eth-signer/advanced/abi.js'
import type { Hex, Address, Hash, AbiParameter, Abi, TupleValue, DecodedFunctionData, DecodedEventLog, Account, ParsedTransaction, BlockTag } from './types'

export { parseAbiItem, parseAbiParameters } from './human-readable-abi'

export const zeroAddress = getAddress('0x0000000000000000000000000000000000000000')
export const zeroHash = `0x${'00'.repeat(32)}` satisfies Hash
export const maxUint256 = amounts.maxUint256

function stripHexPrefix(value: string) {
	return value.startsWith('0x') ? value.slice(2) : value
}

export function ensure0x(value: string): Hex {
	return (value.startsWith('0x') ? value : `0x${value}`) as Hex
}

function ensureEvenHex(value: string) {
	return value.length % 2 === 0 ? value : `0${value}`
}

function isHexCharacter(value: string) {
	return /^[0-9a-fA-F]*$/.test(value)
}

function hexToBigInt(value: string | bigint | number | undefined) {
	if (value === undefined) return undefined
	if (typeof value === 'bigint') return value
	if (typeof value === 'number') return normalizeQuantityValue(value)
	return BigInt(value)
}

function normalizeQuantityValue(value: bigint | number) {
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Number "${value.toString()}" is not in safe integer range`)
		return BigInt(value)
	}
	if (value < 0n) throw new Error(`Number "${value.toString()}n" is not in safe integer range`)
	return value
}

export function bigintToSafeNumber(value: bigint, label = 'Value') {
	if (value < -9_007_199_254_740_991n || value > 9_007_199_254_740_991n) throw new Error(`${label} exceeds the JavaScript safe integer range`)
	return Number.parseInt(value.toString(), 10)
}

export function hexQuantity(value: bigint | number) {
	const normalized = normalizeQuantityValue(value)
	return normalized === 0n ? '0x0' : ensure0x(normalized.toString(16))
}

export function normalizeHexData(value: string | undefined) {
	if (value === undefined) return undefined
	if (!isHex(value, { strict: true })) throw new Error(`Invalid hex value: ${value}`)
	return ensure0x(ensureEvenHex(stripHexPrefix(value).toLowerCase()))
}

export function normalizeBoolean(value: unknown) {
	if (typeof value === 'boolean') return value
	if (typeof value === 'string') {
		if (value === '0x1' || value.toLowerCase() === 'true') return true
		if (value === '0x0' || value.toLowerCase() === 'false') return false
	}
	if (typeof value === 'number') return value !== 0
	if (typeof value === 'bigint') return value !== 0n
	return false
}

export function normalizeTransactionType(value: unknown) {
	if (typeof value !== 'string') return undefined
	switch (value) {
		case '0x0':
			return 'legacy'
		case '0x1':
			return 'eip2930'
		case '0x2':
			return 'eip1559'
		case '0x3':
			return 'eip4844'
		case '0x4':
			return 'eip7702'
		default:
			return value
	}
}

export function normalizeBlockTag(value: bigint | undefined) {
	return value === undefined ? 'latest' : hexQuantity(value)
}

export function transactionCountBlockTag(parameters: { blockNumber?: bigint | undefined; blockTag?: BlockTag | undefined }) {
	if (parameters.blockNumber !== undefined && parameters.blockTag !== undefined) throw new Error('Transaction count cannot specify both blockNumber and blockTag')
	return parameters.blockNumber === undefined ? (parameters.blockTag ?? 'latest') : normalizeBlockTag(parameters.blockNumber)
}

export function normalizeNullableAddress(value: unknown) {
	if (value === null || value === undefined) return undefined
	if (typeof value !== 'string') throw new Error('RPC returned an invalid address')
	if (value === '0x') return undefined
	return getAddress(value)
}

export function normalizeAddress(value: unknown) {
	const normalized = normalizeNullableAddress(value)
	if (normalized === undefined) throw new Error('RPC returned an invalid address')
	return normalized
}

export function normalizeHash(value: unknown) {
	if (typeof value !== 'string' || !isHex(value, { strict: true })) throw new Error('RPC returned an invalid hash')
	const normalized = stripHexPrefix(value).toLowerCase()
	if (normalized.length !== 64) throw new Error('RPC returned an invalid hash')
	return ensure0x(normalized) as Hash
}

export function normalizeRpcHex(value: unknown) {
	if (typeof value !== 'string' || !isHex(value, { strict: true })) throw new Error('RPC returned an invalid hex value')
	return ensure0x(ensureEvenHex(stripHexPrefix(value).toLowerCase()))
}

export function normalizeRpcBigInt(value: unknown, fallback = 0n) {
	if (value === undefined || value === null) return fallback
	if (typeof value === 'bigint') return value
	if (typeof value === 'number') return BigInt(value)
	if (typeof value !== 'string') throw new Error('RPC returned an invalid bigint value')
	return BigInt(value)
}

function normalizeInputValues(values: readonly unknown[] | undefined) {
	return values === undefined ? [] : [...values]
}

function isStaticBytesAbiType(type: string) {
	return /^bytes\d+$/u.test(type)
}

function normalizeCodecValue(parameter: AbiParameter, value: unknown): unknown {
	const arrayItemType = getArrayItemType(parameter.type)
	if (arrayItemType !== undefined) {
		if (!Array.isArray(value)) return value
		return value.map(item => normalizeCodecValue({ ...parameter, type: arrayItemType }, item))
	}
	if (parameter.type.startsWith('tuple')) {
		const components = parameter.components ?? []
		const allNamed = components.every(component => component.name !== undefined && component.name !== '')
		if (Array.isArray(value)) {
			if (!allNamed) {
				return value.map((item, index) => {
					const component = components[index]
					return component === undefined ? item : normalizeCodecValue(component, item)
				})
			}
			return Object.fromEntries(
				components.map((component, index) => {
					const name = component.name
					if (name === undefined || name === '') throw new Error('ABI tuple component name is missing')
					return [name, normalizeCodecValue(component, value[index])]
				}),
			)
		}
		if (typeof value !== 'object' || value === null) return value
		if (!allNamed) {
			return components.map((component, index) => normalizeCodecValue(component, Reflect.get(value, index.toString())))
		}
		return Object.fromEntries(
			components.map(component => {
				const name = component.name
				if (name === undefined || name === '') throw new Error('ABI tuple component name is missing')
				return [name, normalizeCodecValue(component, Reflect.get(value, name))]
			}),
		)
	}
	if ((parameter.type === 'bytes' || isStaticBytesAbiType(parameter.type)) && typeof value === 'string' && isHex(value, { strict: true })) {
		return abiHexToBytes(value)
	}
	return value
}

function abiHexToBytes(value: Hex | string) {
	const stripped = stripHexPrefix(value)
	return nobleHexToBytes(stripped.length % 2 === 0 ? stripped : `${stripped}0`)
}

export function normalizeCodecArguments(parameters: readonly AbiParameter[] | undefined, values: readonly unknown[] | undefined) {
	const normalizedValues = normalizeInputValues(values)
	const resolvedParameters = parameters ?? []
	if (resolvedParameters.length === 0) return normalizedValues
	if (resolvedParameters.length === 1) {
		const parameter = resolvedParameters[0]
		if (parameter === undefined) return normalizedValues[0]
		return normalizeCodecValue(parameter, normalizedValues[0])
	}
	const allNamed = resolvedParameters.every(parameter => parameter.name !== undefined && parameter.name !== '')
	if (!allNamed) {
		return resolvedParameters.map((parameter, index) => normalizeCodecValue(parameter, normalizedValues[index]))
	}
	return Object.fromEntries(
		resolvedParameters.map((parameter, index) => {
			const name = parameter.name
			if (name === undefined || name === '') throw new Error('ABI parameter name is missing')
			return [name, normalizeCodecValue(parameter, normalizedValues[index])]
		}),
	)
}

function normalizeAbiParameterValue(value: unknown, context: string): AbiParameter {
	if (typeof value !== 'object' || value === null) throw new Error(`Invalid ${context}`)
	const parameter = value as Record<string, unknown>
	const type = parameter['type']
	if (typeof type !== 'string') throw new Error(`Invalid ${context}`)
	const normalizeChildParameters = (children: unknown, propertyName: string) => {
		if (!Array.isArray(children)) throw new Error(`Invalid ${context}.${propertyName}`)
		return children.map((child, index) => normalizeAbiParameterValue(child, `${context}.${propertyName}[${index.toString()}]`))
	}
	return {
		...(typeof parameter['anonymous'] === 'boolean' ? { anonymous: parameter['anonymous'] } : {}),
		...(parameter['components'] === undefined ? {} : { components: normalizeChildParameters(parameter['components'], 'components') }),
		...(typeof parameter['indexed'] === 'boolean' ? { indexed: parameter['indexed'] } : {}),
		...(parameter['inputs'] === undefined ? {} : { inputs: normalizeChildParameters(parameter['inputs'], 'inputs') }),
		...(typeof parameter['name'] === 'string' ? { name: parameter['name'] } : {}),
		...(parameter['outputs'] === undefined ? {} : { outputs: normalizeChildParameters(parameter['outputs'], 'outputs') }),
		...(typeof parameter['stateMutability'] === 'string' ? { stateMutability: parameter['stateMutability'] } : {}),
		type,
	}
}

function normalizeAbi(abi: readonly unknown[]) {
	return abi.map((entry, index) => normalizeAbiParameterValue(entry, `abi[${index.toString()}]`))
}

function getArrayItemType(type: string) {
	const match = /^(.*)\[(?:\d*)\]$/u.exec(type)
	return match?.[1]
}

function isIntegerAbiType(type: string) {
	return /^u?int(?:\d+)?$/u.test(type)
}

function normalizeDecodedTuple(components: readonly AbiParameter[], value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item, index) => {
			const component = components[index]
			return component === undefined ? item : normalizeDecodedValue(component, item)
		})
	}
	if (typeof value !== 'object' || value === null) return value
	const tuple = value as Record<string, unknown>
	const normalized: Record<string, unknown> = {}
	for (const [key, currentValue] of Object.entries(tuple)) {
		const componentByIndex = /^\d+$/u.test(key) ? components[Number(key)] : undefined
		const componentByName = componentByIndex ?? components.find(component => component.name === key)
		normalized[key] = componentByName === undefined ? currentValue : normalizeDecodedValue(componentByName, currentValue)
	}
	return normalized
}

function normalizeDecodedValue(parameter: AbiParameter, value: unknown): unknown {
	const arrayItemType = getArrayItemType(parameter.type)
	if (arrayItemType !== undefined) {
		if (!Array.isArray(value)) return value
		return value.map(item => normalizeDecodedValue({ ...parameter, type: arrayItemType }, item))
	}
	if (parameter.type.startsWith('tuple')) {
		return normalizeDecodedTuple(parameter.components ?? [], value)
	}
	if (isIntegerAbiType(parameter.type)) {
		if (typeof value === 'number') return BigInt(value)
		return value
	}
	if (parameter.type === 'address' && typeof value === 'string' && isAddress(value)) return getAddress(value)
	if (parameter.type.startsWith('bytes') && value instanceof Uint8Array) return bytesToHex(value)
	if (parameter.type.startsWith('bytes') && typeof value === 'string' && isHex(value, { strict: true })) return normalizeRpcHex(value)
	return value
}

function normalizeDecodedArguments(parameters: readonly AbiParameter[], value: unknown): unknown[] {
	if (parameters.length === 0) return []
	if (parameters.length === 1) {
		const parameter = parameters[0]
		if (parameter === undefined) return [value]
		return [normalizeDecodedValue(parameter, value)]
	}
	return normalizeDecodeFunctionArgs(value).map((item, index) => {
		const parameter = parameters[index]
		return parameter === undefined ? item : normalizeDecodedValue(parameter, item)
	})
}

function normalizeDecodedFunctionOutput(abiItem: AbiParameter, value: unknown): unknown {
	const outputs = abiItem.outputs ?? []
	if (outputs.length === 0) return undefined
	if (outputs.length === 1) {
		const output = outputs[0]
		if (output === undefined) return value
		return normalizeDecodedValue(output, value)
	}
	return normalizeDecodedTuple(outputs, value)
}

function cloneAbiParameter(parameter: AbiParameter, options: { stripName: boolean }): AbiParameter {
	const nameProperties = (() => {
		if (options.stripName) return {}
		if (parameter.name === undefined) return {}
		return { name: parameter.name }
	})()
	return {
		...nameProperties,
		...(parameter.anonymous === undefined ? {} : { anonymous: parameter.anonymous }),
		...(parameter.indexed === undefined ? {} : { indexed: parameter.indexed }),
		...(parameter.inputs === undefined ? {} : { inputs: parameter.inputs.map((input: AbiParameter) => cloneAbiParameter(input, { stripName: false })) }),
		...(parameter.outputs === undefined ? {} : { outputs: parameter.outputs.map((output: AbiParameter) => cloneAbiParameter(output, { stripName: false })) }),
		...(parameter.components === undefined ? {} : { components: parameter.components.map((component: AbiParameter) => cloneAbiParameter(component, { stripName: false })) }),
		...(parameter.stateMutability === undefined ? {} : { stateMutability: parameter.stateMutability }),
		type: parameter.type,
	}
}

function normalizeFunctionAbiForCodec(abiItem: AbiParameter): AbiParameter {
	return {
		...(abiItem.name === undefined ? {} : { name: abiItem.name }),
		...(abiItem.inputs === undefined
			? {}
			: {
					inputs: abiItem.inputs.map((input: AbiParameter) => cloneAbiParameter(input, { stripName: true })),
				}),
		...(abiItem.outputs === undefined
			? {}
			: {
					outputs: abiItem.outputs.map((output: AbiParameter, _index: number, outputs: readonly AbiParameter[]) => cloneAbiParameter(output, { stripName: outputs.length !== 1 || !output.type.startsWith('tuple') })),
				}),
		...(abiItem.stateMutability === undefined ? {} : { stateMutability: abiItem.stateMutability }),
		type: abiItem.type,
	}
}

function normalizeFunctionAbiForEncoder(abiItem: AbiParameter): AbiParameter {
	return {
		...(abiItem.name === undefined ? {} : { name: abiItem.name }),
		...(abiItem.inputs === undefined
			? {}
			: {
					inputs: abiItem.inputs.map((input: AbiParameter) => cloneAbiParameter(input, { stripName: false })),
				}),
		...(abiItem.outputs === undefined
			? {}
			: {
					outputs: abiItem.outputs.map((output: AbiParameter, _index: number, outputs: readonly AbiParameter[]) => cloneAbiParameter(output, { stripName: outputs.length !== 1 || !output.type.startsWith('tuple') })),
				}),
		...(abiItem.stateMutability === undefined ? {} : { stateMutability: abiItem.stateMutability }),
		type: abiItem.type,
	}
}

export function getNamedFunctionAbi(abi: readonly unknown[], functionName: string, args?: readonly unknown[]) {
	const normalizedAbi = normalizeAbi(abi)
	const signatureMatch = normalizedAbi.find((entry: AbiParameter) => entry.type === 'function' && getAbiSignature(entry) === functionName)
	if (signatureMatch !== undefined) return signatureMatch

	const matchingEntries = normalizedAbi.filter((entry: AbiParameter) => entry.type === 'function' && entry.name === functionName)
	if (matchingEntries.length === 0) {
		throw new Error(`Function "${functionName}" was not found in the ABI`)
	}
	if (matchingEntries.length === 1) {
		const onlyEntry = matchingEntries[0]
		if (onlyEntry === undefined) throw new Error(`Function "${functionName}" was not found in the ABI`)
		return onlyEntry
	}

	const argumentCount = args?.length ?? 0
	const arityMatches = matchingEntries.filter((entry: AbiParameter) => (entry.inputs?.length ?? 0) === argumentCount)
	if (arityMatches.length === 1) {
		const arityMatch = arityMatches[0]
		if (arityMatch === undefined) throw new Error(`Function "${functionName}" was not found in the ABI`)
		return arityMatch
	}
	if (arityMatches.length > 1) {
		const compatibleMatches = arityMatches.filter((entry: AbiParameter) => canEncodeFunctionArguments(entry, args))
		if (compatibleMatches.length === 1) {
			const compatibleMatch = compatibleMatches[0]
			if (compatibleMatch === undefined) throw new Error(`Function "${functionName}" was not found in the ABI`)
			return compatibleMatch
		}
		if (compatibleMatches.length > 1) {
			throw new Error(`Function "${functionName}" is overloaded and remained ambiguous for the provided argument shape`)
		}
	}

	throw new Error(`Function "${functionName}" is overloaded and could not be resolved from ${argumentCount.toString()} arguments`)
}

function canEncodeFunctionArguments(abiItem: AbiParameter, args: readonly unknown[] | undefined) {
	try {
		const method = getContractMethod(abiItem)
		method.encodeInput(normalizeCodecArguments(abiItem.inputs, args))
		return true
	} catch (error) {
		if (error instanceof Error) return false
		return false
	}
}

export function getNamedEventAbi(abi: readonly unknown[], eventName: string) {
	for (const entry of normalizeAbi(abi)) {
		if (entry.type !== 'event') continue
		if (entry.name === eventName) return entry
	}
	throw new Error(`Event "${eventName}" was not found in the ABI`)
}

export function getContractMethod(abiItem: AbiParameter) {
	if (abiItem.name === undefined) throw new Error('ABI function is missing a name')
	const contract = createContract([normalizeFunctionAbiForEncoder(abiItem)] as never) as Record<
		string,
		{
			decodeOutput: (value: Uint8Array) => unknown
			encodeInput: (value: unknown) => Uint8Array
		}
	>
	const method = contract[abiItem.name]
	if (method === undefined) throw new Error(`Function "${abiItem.name}" could not be created`)
	return method
}

function normalizeDecodeFunctionArgs(value: unknown) {
	if (value === undefined) return []
	return Array.isArray(value) ? value : [value]
}

export function decodeFunctionOutput(abiItem: AbiParameter, data: Hex) {
	const method = getContractMethod(abiItem)
	return normalizeDecodedFunctionOutput(abiItem, method.decodeOutput(nobleHexToBytes(stripHexPrefix(data))))
}

function rlpEncodeBytes(value: Uint8Array): Uint8Array {
	if (value.length === 1 && value[0] !== undefined && value[0] < 0x80) return value
	if (value.length <= 55) return concatBytes(Uint8Array.of(0x80 + value.length), value)
	const lengthBytes = bigintToBytes(BigInt(value.length))
	return concatBytes(Uint8Array.of(0xb7 + lengthBytes.length), lengthBytes, value)
}

function rlpEncodeList(items: readonly Uint8Array[]) {
	const payload = concatBytes(...items)
	if (payload.length <= 55) return concatBytes(Uint8Array.of(0xc0 + payload.length), payload)
	const lengthBytes = bigintToBytes(BigInt(payload.length))
	return concatBytes(Uint8Array.of(0xf7 + lengthBytes.length), lengthBytes, payload)
}

function bigintToBytes(value: bigint) {
	if (value === 0n) return new Uint8Array([])
	let hex = value.toString(16)
	hex = ensureEvenHex(hex)
	return nobleHexToBytes(hex)
}

function checksumAddressFromBytes(value: Uint8Array) {
	return getAddress(ensure0x(nobleBytesToHex(value).slice(-40)))
}

export function normalizeEventTopicArgs(eventAbi: AbiParameter, args: readonly unknown[] | Record<string, unknown> | undefined) {
	const inputs = eventAbi.inputs ?? []
	const hasNames = inputs.every((input: AbiParameter) => input.name !== undefined)
	const normalizeTopicValue = (input: AbiParameter, value: unknown) => {
		if (value === null || value === undefined) return null
		if (input.type === 'bytes' && typeof value === 'string' && isHex(value, { strict: true })) return hexToBytes(value)
		return normalizeCodecValue(input, value)
	}
	if (args === undefined) {
		if (hasNames) {
			return Object.fromEntries(inputs.map((input: AbiParameter) => [input.name as string, null]))
		}
		return inputs.map(() => null)
	}
	if (!hasNames || Array.isArray(args)) {
		let indexedInputIndex = 0
		const usesFullInputArray = Array.isArray(args) && args.length === inputs.length
		return inputs.map((input, inputIndex) => {
			if (input.indexed !== true) return null
			const value = Array.isArray(args) ? args[usesFullInputArray ? inputIndex : indexedInputIndex] : undefined
			indexedInputIndex += 1
			return normalizeTopicValue(input, value)
		})
	}
	return Object.fromEntries(
		inputs.map(input => {
			const name = input.name
			if (name === undefined) throw new Error('ABI event input name is missing')
			return [name, input.indexed === true ? normalizeTopicValue(input, Reflect.get(args, name)) : null]
		}),
	)
}

function createDecodeError(name: string, message: string) {
	const error = new Error(message)
	error.name = name
	return error
}

export function getEventDecoder(eventAbi: AbiParameter) {
	if (eventAbi.name === undefined) throw new Error('ABI event is missing a name')
	const contractEvents = events([eventAbi as never]) as Record<
		string,
		{
			decode: (topics: string[], data: string) => unknown
			topics: (values: readonly unknown[] | Record<string, unknown>) => (string | null)[]
		}
	>
	const eventDecoder = contractEvents[eventAbi.name]
	if (eventDecoder === undefined) throw new Error(`Event "${eventAbi.name}" could not be created`)
	return eventDecoder
}

function getAbiSignature(parameter: AbiParameter): string {
	if (parameter.type === 'function' || parameter.type === 'event') {
		return `${parameter.name ?? 'function'}(${(parameter.inputs ?? []).map((input: AbiParameter) => getAbiSignature(input)).join(',')})`
	}
	if (parameter.type.startsWith('tuple')) {
		return `(${(parameter.components ?? []).map((component: AbiParameter) => getAbiSignature(component)).join(',')})${parameter.type.slice(5)}`
	}
	return parameter.type
}

export function getEventSignatureHash(eventAbi: AbiParameter) {
	return stripHexPrefix(keccak256(getAbiSignature(eventAbi))).toLowerCase()
}

function ensureConstructorAbi(abi: readonly unknown[]) {
	const normalizedAbi = normalizeAbi(abi)
	return normalizedAbi.some(entry => entry.type === 'constructor')
		? normalizedAbi
		: [
				...normalizedAbi,
				{
					inputs: [],
					type: 'constructor',
				} satisfies AbiParameter,
			]
}

export function getAddress(value: string): Address {
	if (value.startsWith('0X')) throw new Error(`Invalid address: ${value}`)
	const parsed = addr.parse(value)
	if (!addr.isValid(value)) throw new Error(`Invalid address: ${value}`)
	return ensure0x(addr.addChecksum(parsed.hasPrefix ? value : parsed.data)) as Address
}

export function isAddress(value: string) {
	if (value.startsWith('0X')) return false
	return addr.isValid(value)
}

export function isHex(value: string, options: { strict?: boolean | undefined } = {}) {
	if (options.strict === true && !value.startsWith('0x')) return false
	if (!value.startsWith('0x')) return false
	if (value === '0x') return true
	const normalized = stripHexPrefix(value)
	return isHexCharacter(normalized)
}

export function bytesToHex(value: Uint8Array) {
	return ensure0x(nobleBytesToHex(value))
}

export function hexToBytes(value: Hex | string) {
	return nobleHexToBytes(ensureEvenHex(stripHexPrefix(value)))
}

export function concatHex(values: readonly Hex[]) {
	return ensure0x(values.map(value => stripHexPrefix(value)).join(''))
}

export function toHex(value: bigint | number | string | Uint8Array, options: { size?: number | undefined } = {}) {
	if (typeof value === 'string') {
		return ensure0x(nobleBytesToHex(utf8ToBytes(value)))
	}
	if (typeof value === 'bigint' || typeof value === 'number') {
		const bigintValue = normalizeQuantityValue(value)
		if (options.size === undefined) return hexQuantity(bigintValue)
		const bytes = bigintToBytes(bigintValue)
		if (bytes.length > options.size) throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`)
		return ensure0x(nobleBytesToHex(Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes])))
	}
	const bytes = value
	if (options.size === undefined) return ensure0x(nobleBytesToHex(bytes))
	if (bytes.length > options.size) throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`)
	return ensure0x(nobleBytesToHex(Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes])))
}

export function numberToBytes(value: bigint | number, options: { size?: number | undefined } = {}) {
	const bytes = bigintToBytes(normalizeQuantityValue(value))
	if (options.size === undefined) return bytes
	if (bytes.length > options.size) throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`)
	return Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes])
}

export function keccak256(value: Hex | Uint8Array | string) {
	if (typeof value === 'string' && value.startsWith('0x')) {
		return ensure0x(nobleBytesToHex(keccak_256(hexToBytes(value))))
	}
	const bytes = typeof value === 'string' ? utf8ToBytes(value) : value
	return ensure0x(nobleBytesToHex(keccak_256(bytes)))
}

export function encodeAbiParameters(parameters: readonly AbiParameter[], values: readonly unknown[]) {
	return deployContract(
		[
			{
				inputs: parameters.map(parameter => cloneAbiParameter(parameter, { stripName: false })),
				type: 'constructor',
			},
		],
		'0x',
		normalizeCodecArguments(parameters, values),
	) as Hex
}

export function encodeFunctionData(parameters: { abi: readonly unknown[]; args?: readonly unknown[]; functionName: string }): Hex
export function encodeFunctionData(parameters: { abi: readonly unknown[]; args?: readonly unknown[]; functionName: string }) {
	const abiItem = getNamedFunctionAbi(parameters.abi, parameters.functionName, parameters.args)
	const method = getContractMethod(abiItem)
	return ensure0x(nobleBytesToHex(method.encodeInput(normalizeCodecArguments(abiItem.inputs, parameters.args))))
}

export function decodeFunctionData<TAbi extends Abi>(parameters: { abi: TAbi; data: Hex }): DecodedFunctionData<TAbi>
export function decodeFunctionData(parameters: { abi: Abi; data: Hex }): {
	args: readonly unknown[]
	functionName: string
}
export function decodeFunctionData(parameters: { abi: Abi; data: Hex }) {
	const strippedAbi = normalizeAbi(parameters.abi)
		.filter((entry: AbiParameter) => entry.type === 'function')
		.map((entry: AbiParameter) => ({
			...normalizeFunctionAbiForCodec(entry),
			outputs: entry.outputs,
		}))
	const decoder = new Decoder()
	decoder.add(zeroAddress, strippedAbi as never)
	const decoded = decoder.decode(zeroAddress, nobleHexToBytes(stripHexPrefix(parameters.data)), {})
	if (decoded === undefined || Array.isArray(decoded)) throw new Error('Function selector was not found in the ABI')
	const functionAbi = getNamedFunctionAbi(parameters.abi, decoded.signature ?? decoded.name, normalizeDecodeFunctionArgs(decoded.value))
	return {
		args: normalizeDecodedArguments(functionAbi.inputs ?? [], decoded.value),
		functionName: decoded.name,
	}
}

function encodeDeploymentWithMicroEthSigner(abi: Abi, bytecode: Hex, constructorArguments: readonly unknown[]) {
	const deploymentEncoder = deployContract as (...args: readonly unknown[]) => unknown
	const encoded = deploymentEncoder(...[abi, bytecode, ...constructorArguments])
	if (typeof encoded !== 'string' || !isHex(encoded, { strict: true })) {
		throw new Error('Contract deployment encoding returned an invalid hex value')
	}
	return normalizeRpcHex(encoded)
}

export function encodeDeployData(parameters: { abi: Abi; args?: readonly unknown[]; bytecode: Hex }) {
	const constructorAbi = ensureConstructorAbi(parameters.abi)
	const constructorParameters = constructorAbi.find(entry => entry.type === 'constructor')?.inputs ?? []
	const constructorArguments = constructorParameters.length === 0 ? [] : [normalizeCodecArguments(constructorParameters, parameters.args)]
	return encodeDeploymentWithMicroEthSigner(constructorAbi, parameters.bytecode, constructorArguments)
}

export function decodeEventLog<TAbi extends Abi>(parameters: { abi: TAbi; data: Hex; topics: readonly Hex[] }): DecodedEventLog<TAbi>
export function decodeEventLog(parameters: { abi: Abi; data: Hex; topics: readonly Hex[] }): {
	args: TupleValue<readonly AbiParameter[], 'output'>
	eventName: string
}
export function decodeEventLog(parameters: { abi: Abi; data: Hex; topics: readonly Hex[] }) {
	const selector = parameters.topics[0]
	if (selector === undefined) throw createDecodeError('DecodeLogTopicsMismatch', 'Event topics were missing')
	const matchingEvent = normalizeAbi(parameters.abi).find((entry: AbiParameter) => entry.type === 'event' && getEventSignatureHash(entry) === stripHexPrefix(selector).toLowerCase())
	if (matchingEvent === undefined || matchingEvent.name === undefined) {
		throw createDecodeError('AbiEventSignatureNotFoundError', 'Event signature was not found in the ABI')
	}
	try {
		const decodedArgs = getEventDecoder(matchingEvent).decode(parameters.topics as string[], parameters.data)
		return {
			args: normalizeDecodedTuple(matchingEvent.inputs ?? [], decodedArgs),
			eventName: matchingEvent.name,
		}
	} catch (error) {
		if (error instanceof Error && error.message.toLowerCase().includes('topic')) {
			throw createDecodeError('DecodeLogTopicsMismatch', error.message)
		}
		if (error instanceof Error) throw createDecodeError('DecodeLogDataMismatch', error.message)
		throw createDecodeError('DecodeLogDataMismatch', 'Failed to decode event log')
	}
}

export function encodeEventTopics(parameters: { abi: Abi; args?: readonly unknown[] | Record<string, unknown> | undefined; eventName: string }) {
	const eventAbi = getNamedEventAbi(parameters.abi, parameters.eventName)
	return getEventDecoder(eventAbi)
		.topics(normalizeEventTopicArgs(eventAbi, parameters.args))
		.map((topic: string | null) => (topic === null ? null : ensure0x(topic)))
}

export function parseTransaction(serializedTransaction: Hex) {
	const transaction = Transaction.fromHex(serializedTransaction)
	return {
		chainId: 'chainId' in transaction.raw && typeof transaction.raw.chainId === 'bigint' ? transaction.raw.chainId : undefined,
		data: normalizeHexData(transaction.raw.data),
		gas: 'gasLimit' in transaction.raw ? transaction.raw.gasLimit : undefined,
		gasPrice: 'gasPrice' in transaction.raw && typeof transaction.raw.gasPrice === 'bigint' ? transaction.raw.gasPrice : undefined,
		maxFeePerGas: 'maxFeePerGas' in transaction.raw && typeof transaction.raw.maxFeePerGas === 'bigint' ? transaction.raw.maxFeePerGas : undefined,
		maxPriorityFeePerGas: 'maxPriorityFeePerGas' in transaction.raw && typeof transaction.raw.maxPriorityFeePerGas === 'bigint' ? transaction.raw.maxPriorityFeePerGas : undefined,
		nonce: 'nonce' in transaction.raw ? transaction.raw.nonce : undefined,
		to: transaction.raw.to === '0x' ? undefined : getAddress(transaction.raw.to),
		type: transaction.type,
		value: 'value' in transaction.raw ? transaction.raw.value : undefined,
	} satisfies ParsedTransaction
}

export async function recoverTransactionAddress(parameters: { serializedTransaction: Hex }) {
	return getAddress(Transaction.fromHex(parameters.serializedTransaction).sender)
}

export function privateKeyToAccount(privateKey: Hex) {
	return {
		address: getAddress(addr.fromPrivateKey(privateKey)),
		signMessage: async message => ensure0x(eip191Signer.sign(message, privateKey)),
		signTransaction: async parameters => {
			const type = parameters.gasPrice !== undefined ? 'legacy' : 'eip1559'
			const transaction = Transaction.prepare({
				chainId: hexToBigInt(parameters.chainId) ?? 1n,
				data: parameters.data ?? '0x',
				gasLimit: hexToBigInt(parameters.gas) ?? 21_000n,
				...(type === 'legacy'
					? {
							gasPrice: parameters.gasPrice ?? 0n,
							type,
						}
					: {
							maxFeePerGas: parameters.maxFeePerGas ?? parameters.maxPriorityFeePerGas ?? 0n,
							maxPriorityFeePerGas: parameters.maxPriorityFeePerGas ?? 0n,
							type,
						}),
				nonce: hexToBigInt(parameters.nonce) ?? 0n,
				to: parameters.to ?? '0x',
				value: parameters.value ?? 0n,
			})
			return transaction.signBy(privateKey).toHex() as Hex
		},
		type: 'local',
	} satisfies Account
}

export function getCreateAddress(parameters: { from: Address; nonce: bigint }) {
	const fromBytes = nobleHexToBytes(stripHexPrefix(parameters.from))
	const nonceBytes = parameters.nonce === 0n ? new Uint8Array([]) : bigintToBytes(parameters.nonce)
	const encoded = rlpEncodeList([rlpEncodeBytes(fromBytes), rlpEncodeBytes(nonceBytes)])
	return checksumAddressFromBytes(keccak_256(encoded).slice(-20))
}

export function getCreate2Address(parameters: { bytecode?: Hex | undefined; bytecodeHash?: Hex | undefined; from: Address; salt: Hex | Uint8Array }) {
	const fromBytes = nobleHexToBytes(stripHexPrefix(parameters.from))
	const saltBytes = parameters.salt instanceof Uint8Array ? parameters.salt : hexToBytes(parameters.salt)
	if (saltBytes.length !== 32) throw new Error('CREATE2 salt must be 32 bytes')
	const bytecodeHashBytes = (() => {
		if (parameters.bytecodeHash !== undefined) return hexToBytes(parameters.bytecodeHash)
		if (parameters.bytecode === undefined) return undefined
		return keccak_256(hexToBytes(parameters.bytecode))
	})()
	if (bytecodeHashBytes === undefined) throw new Error('CREATE2 address derivation requires bytecode or bytecodeHash')
	const encoded = concatBytes(Uint8Array.of(0xff), fromBytes, saltBytes, bytecodeHashBytes)
	return checksumAddressFromBytes(keccak_256(encoded).slice(-20))
}

export function parseUnits(value: string, decimals: number) {
	const trimmed = value.trim()
	if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) throw new Error(`Invalid decimal value: ${value}`)
	const negative = trimmed.startsWith('-')
	const normalized = negative ? trimmed.slice(1) : trimmed
	const [wholePartRaw, fractionPartRaw = ''] = normalized.split('.')
	const wholePart = wholePartRaw === '' ? '0' : wholePartRaw
	const trimmedFraction = fractionPartRaw.replace(/0+$/, '')
	if (trimmedFraction.length > decimals) throw new Error(`Too many decimal places: expected at most ${decimals.toString()}`)
	const paddedFraction = trimmedFraction.padEnd(decimals, '0')
	const combined = `${wholePart}${paddedFraction}`.replace(/^0+/, '') || '0'
	const result = BigInt(combined)
	return negative ? -result : result
}

export function formatUnits(value: bigint, decimals: number) {
	const negative = value < 0n
	const normalized = negative ? -value : value
	const base = 10n ** BigInt(decimals)
	const whole = normalized / base
	const fraction = normalized % base
	if (fraction === 0n) return `${negative ? '-' : ''}${whole.toString()}`
	const fractionString = fraction.toString().padStart(decimals, '0').replace(/0+$/, '')
	return `${negative ? '-' : ''}${whole.toString()}.${fractionString}`
}

export function formatEther(value: bigint) {
	return formatUnits(value, 18)
}

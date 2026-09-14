import { type Abi, type AbiParameter, type AbiValue, type ContractFunctionResult, type DecodedFunctionData, type Hex } from '../types.js'

import { bytesToHex, ensure0x, getAddress, isAddress, isHex, keccak256, normalizeRpcHex, stripHexPrefix } from '../encoding.js'

import { bytesToHex as nobleBytesToHex, hexToBytes as nobleHexToBytes } from '@noble/hashes/utils.js'

import { Decoder, createContract, deployContract } from 'micro-eth-signer/advanced/abi.js'

import { zeroAddress } from '../chains.js'

export const MULTICALL3_ABI = [
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

function normalizeInputValues(values: readonly unknown[] | undefined) {
	return values === undefined ? [] : [...values]
}

export function isStaticBytesAbiType(type: string) {
	return /^bytes\d+$/u.test(type)
}

export function normalizeCodecValue(parameter: AbiParameter, value: unknown): unknown {
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

export function normalizeAbi(abi: readonly unknown[]) {
	return abi.map((entry, index) => normalizeAbiParameterValue(entry, `abi[${index.toString()}]`))
}

function getArrayItemType(type: string) {
	const match = /^(.*)\[(?:\d*)\]$/u.exec(type)
	return match?.[1]
}

export function isIntegerAbiType(type: string) {
	return /^u?int(?:\d+)?$/u.test(type)
}

export function normalizeDecodedTuple(components: readonly AbiParameter[], value: unknown): unknown {
	if (Array.isArray(value)) {
		const normalized = value.map((item, index) => {
			const component = components[index]
			return component === undefined ? item : normalizeDecodedValue(component, item)
		})
		if (components.length === 0 || components.some(component => component.name === undefined || component.name === '')) return normalized
		for (const [index, component] of components.entries()) {
			if (component.name === undefined || component.name === '') throw new Error('Decoded tuple alias eligibility changed during normalization')
			if (component.name in normalized || /^(?:0|[1-9]\d*)$/u.test(component.name)) continue
			Object.defineProperty(normalized, component.name, {
				configurable: false,
				enumerable: false,
				value: normalized[index],
				writable: false,
			})
		}
		return normalized
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
	try {
		const method = getContractMethod(abiItem)
		return normalizeDecodedFunctionOutput(abiItem, method.decodeOutput(nobleHexToBytes(stripHexPrefix(data))))
	} catch (cause) {
		const error = new Error(`Unable to decode ${abiItem.name ?? 'contract function'} result`, { cause })
		error.name = 'AbiDecodingError'
		throw error
	}
}

export function createDecodeError(name: string, message: string) {
	const error = new Error(message)
	error.name = name
	return error
}

export function getAbiSignature(parameter: AbiParameter): string {
	if (parameter.type === 'function' || parameter.type === 'event') {
		return `${parameter.name ?? 'function'}(${(parameter.inputs ?? []).map((input: AbiParameter) => getAbiSignature(input)).join(',')})`
	}
	if (parameter.type.startsWith('tuple')) {
		return `(${(parameter.components ?? []).map((component: AbiParameter) => getAbiSignature(component)).join(',')})${parameter.type.slice(5)}`
	}
	return parameter.type
}

export function formatAbiParameter(parameter: AbiParameter): string {
	const type = parameter.type.startsWith('tuple') ? `(${(parameter.components ?? []).map(formatAbiParameter).join(', ')})${parameter.type.slice(5)}` : parameter.type
	return [type, parameter.indexed === true ? 'indexed' : undefined, parameter.name].filter((value): value is string => value !== undefined && value !== '').join(' ')
}

export function formatAbiItem(parameter: AbiParameter): string {
	if (parameter.type !== 'event' && parameter.type !== 'function') return getAbiSignature(parameter)
	const inputs = (parameter.inputs ?? []).map(formatAbiParameter).join(', ')
	const outputs = parameter.type === 'function' && (parameter.outputs?.length ?? 0) > 0 ? ` returns (${(parameter.outputs ?? []).map(formatAbiParameter).join(', ')})` : ''
	const stateMutability = parameter.type === 'function' && parameter.stateMutability !== undefined && parameter.stateMutability !== 'nonpayable' ? ` ${parameter.stateMutability}` : ''
	const anonymous = parameter.type === 'event' && parameter.anonymous === true ? ' anonymous' : ''
	return `${parameter.type} ${parameter.name ?? ''}(${inputs})${stateMutability}${outputs}${anonymous}`
}

export function toFunctionSelector(parameter: AbiParameter): Hex {
	if (parameter.type !== 'function') throw new Error('ABI item is not a function')
	return `0x${keccak256(getAbiSignature(parameter)).slice(2, 10)}`
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
	args: readonly AbiValue[]
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
		args: normalizeDecodedArguments(functionAbi.inputs ?? [], decoded.value) as AbiValue[],
		functionName: decoded.name,
	}
}

/** @internal Test fixtures decode call results with this; production reads through readContract. */
export function decodeFunctionResult<TAbi extends Abi, TFunctionName extends string>(parameters: { abi: TAbi; data: Hex; functionName: TFunctionName }): ContractFunctionResult<TAbi, TFunctionName> {
	return decodeFunctionOutput(getNamedFunctionAbi(parameters.abi, parameters.functionName), parameters.data) as ContractFunctionResult<TAbi, TFunctionName>
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

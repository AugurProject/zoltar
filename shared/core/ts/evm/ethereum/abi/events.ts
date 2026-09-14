import { createDecodeError, getAbiSignature, isIntegerAbiType, isStaticBytesAbiType, normalizeAbi, normalizeCodecValue, normalizeDecodedTuple } from './codec.js'

import { type Abi, type AbiParameter, type AbiValue, type DecodedEventArguments, type DecodedEventLog, type EncodedEventTopic, type Hex } from '../types.js'

import { ensure0x, hexToBytes, isHex, keccak256, stripHexPrefix } from '../encoding.js'

import { zeroAddress } from '../chains.js'

import { events } from 'micro-eth-signer/advanced/abi.js'

function getNamedEventAbi(abi: readonly unknown[], eventName: string) {
	for (const entry of normalizeAbi(abi)) {
		if (entry.type !== 'event') continue
		if (entry.name === eventName) return entry
	}
	throw new Error(`Event "${eventName}" was not found in the ABI`)
}

function normalizeEventTopicArgs(eventAbi: AbiParameter, args: readonly unknown[] | Record<string, unknown> | undefined) {
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

function eventTopicWildcardPlaceholder(input: AbiParameter): AbiValue {
	const arrayMatch = /^(.*)\[(\d*)\]$/u.exec(input.type)
	if (arrayMatch !== null) {
		const itemType = arrayMatch[1]
		const lengthText = arrayMatch[2]
		if (itemType === undefined || lengthText === undefined || lengthText === '') return []
		const length = Number(lengthText)
		if (!Number.isSafeInteger(length) || length < 0) throw new Error(`Invalid ABI array length ${lengthText}`)
		return Array.from({ length }, () => eventTopicWildcardPlaceholder({ ...input, type: itemType }))
	}
	if (input.type.startsWith('tuple')) {
		const components = input.components ?? []
		const named = components.every(component => component.name !== undefined && component.name !== '')
		if (!named) return components.map(eventTopicWildcardPlaceholder)
		return Object.fromEntries(
			components.map(component => {
				const name = component.name
				if (name === undefined || name === '') throw new Error('ABI tuple component name is missing')
				return [name, eventTopicWildcardPlaceholder(component)]
			}),
		)
	}
	if (input.type === 'address') return zeroAddress
	if (input.type === 'bool') return false
	if (input.type === 'string') return ''
	if (input.type === 'bytes') return new Uint8Array()
	if (isStaticBytesAbiType(input.type)) {
		const size = Number(input.type.slice('bytes'.length))
		if (!Number.isSafeInteger(size) || size < 1 || size > 32) throw new Error(`Invalid ABI byte width ${input.type}`)
		return new Uint8Array(size)
	}
	if (isIntegerAbiType(input.type)) return 0n
	throw new Error(`Cannot construct a wildcard placeholder for indexed ABI type ${input.type}`)
}

function getEventDecoder(eventAbi: AbiParameter) {
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

export function toEventSelector(parameter: AbiParameter): Hex {
	if (parameter.type !== 'event') throw new Error('ABI item is not an event')
	return keccak256(getAbiSignature(parameter))
}

function getEventSignatureHash(eventAbi: AbiParameter) {
	return stripHexPrefix(keccak256(getAbiSignature(eventAbi))).toLowerCase()
}

export function decodeEventLog<TAbi extends Abi>(parameters: { abi: TAbi; data: Hex; topics: readonly Hex[] }): DecodedEventLog<TAbi>

export function decodeEventLog(parameters: { abi: Abi; data: Hex; topics: readonly Hex[] }): {
	args: DecodedEventArguments<readonly AbiParameter[]>
	eventName: string
}

export function decodeEventLog(parameters: { abi: Abi; data: Hex; topics: readonly Hex[] }) {
	const selector = parameters.topics[0]
	const matchingEvents = normalizeAbi(parameters.abi).filter((entry: AbiParameter): entry is AbiParameter & { name: string } => entry.type === 'event' && entry.name !== undefined && (entry.anonymous === true || (selector !== undefined && getEventSignatureHash(entry) === stripHexPrefix(selector).toLowerCase())))
	if (matchingEvents.length === 0) {
		if (selector === undefined) throw createDecodeError('DecodeLogTopicsMismatch', 'Event topics were missing')
		throw createDecodeError('AbiEventSignatureNotFoundError', 'Event signature was not found in the ABI')
	}
	const decodedEvents: { args: unknown; eventName: string }[] = []
	let firstDecodeError: Error | undefined
	for (const matchingEvent of matchingEvents) {
		try {
			const decodedArgs = getEventDecoder(matchingEvent).decode(parameters.topics as string[], parameters.data)
			decodedEvents.push({
				args: normalizeDecodedTuple(matchingEvent.inputs ?? [], decodedArgs),
				eventName: matchingEvent.name,
			})
		} catch (error) {
			if (firstDecodeError !== undefined) continue
			if (error instanceof Error && error.message.toLowerCase().includes('topic')) firstDecodeError = createDecodeError('DecodeLogTopicsMismatch', error.message)
			else if (error instanceof Error) firstDecodeError = createDecodeError('DecodeLogDataMismatch', error.message)
			else firstDecodeError = createDecodeError('DecodeLogDataMismatch', 'Failed to decode event log')
		}
	}
	if (decodedEvents.length === 1) return decodedEvents[0]
	if (decodedEvents.length > 1) throw createDecodeError('AbiEventSignatureAmbiguousError', 'Event log matches more than one ABI event')
	throw firstDecodeError ?? createDecodeError('DecodeLogDataMismatch', 'Failed to decode event log')
}

/** @internal Production filters logs through getLogs; tests build topic fixtures with this encoder. */
export function encodeEventTopics<const TArgs extends readonly unknown[] | Record<string, unknown> | undefined = undefined>(parameters: { abi: Abi; args?: TArgs; eventName: string }): readonly (EncodedEventTopic<TArgs> | null)[]

export function encodeEventTopics(parameters: { abi: Abi; args?: readonly unknown[] | Record<string, unknown> | undefined; eventName: string }): readonly (Hex | readonly Hex[] | null)[] {
	const eventAbi = getNamedEventAbi(parameters.abi, parameters.eventName)
	const decoder = getEventDecoder(eventAbi)
	const inputs = eventAbi.inputs ?? []
	const normalizedArgs = normalizeEventTopicArgs(eventAbi, parameters.args)
	const encodeNormalizedTopics = (values: ReturnType<typeof normalizeEventTopicArgs>) => {
		const withPlaceholders = Array.isArray(values)
			? inputs.map((input, index) => (input.indexed === true && values[index] === null ? eventTopicWildcardPlaceholder(input) : values[index]))
			: Object.fromEntries(
					inputs.map(input => {
						const name = input.name
						if (name === undefined) throw new Error('ABI event input name is missing')
						const value = Reflect.get(values, name)
						return [name, input.indexed === true && value === null ? eventTopicWildcardPlaceholder(input) : value]
					}),
				)
		const topics = decoder.topics(withPlaceholders) as Array<string | null>
		let topicIndex = eventAbi.anonymous === true ? 0 : 1
		for (const [inputIndex, input] of inputs.entries()) {
			if (input.indexed !== true) continue
			let value: unknown
			if (Array.isArray(values)) value = values[inputIndex]
			else if (input.name !== undefined) value = Reflect.get(values, input.name)
			if (value === null) topics[topicIndex] = null
			topicIndex += 1
		}
		return topics.map(topic => (topic === null ? null : ensure0x(topic)))
	}
	const usesFullInputArray = Array.isArray(parameters.args) && parameters.args.length === inputs.length
	let indexedInputIndex = 0
	const alternatives = inputs.flatMap((input, inputIndex) => {
		const indexedPosition = indexedInputIndex
		if (input.indexed === true) indexedInputIndex += 1
		if (input.indexed !== true || input.type.includes('[') || input.type.startsWith('tuple')) return []
		const argumentIndex = usesFullInputArray ? inputIndex : indexedPosition
		let value: unknown
		if (Array.isArray(parameters.args)) value = parameters.args[argumentIndex]
		else if (parameters.args !== undefined && input.name !== undefined) value = Reflect.get(parameters.args, input.name)
		return Array.isArray(value) ? [{ input, inputIndex, selectionIndex: Array.isArray(parameters.args) ? argumentIndex : inputIndex, values: value }] : []
	})
	if (alternatives.length === 0) return encodeNormalizedTopics(normalizedArgs)
	const withAlternatives = (selected: ReadonlyMap<number, unknown>) =>
		normalizeEventTopicArgs(
			eventAbi,
			Array.isArray(parameters.args)
				? parameters.args.map((value, argumentIndex) => selected.get(argumentIndex) ?? value)
				: Object.fromEntries(inputs.map((input, inputIndex) => [input.name as string, selected.get(inputIndex) ?? (parameters.args === undefined ? undefined : Reflect.get(parameters.args, input.name as string))])),
		)
	const defaults = new Map(alternatives.map(({ selectionIndex, values }) => [selectionIndex, values[0]]))
	const topics: Array<Hex | readonly Hex[] | null> = encodeNormalizedTopics(withAlternatives(defaults))
	for (const { input, inputIndex, selectionIndex, values } of alternatives) {
		const topicIndex = inputs.slice(0, inputIndex + 1).filter(candidate => candidate.indexed === true).length
		topics[topicIndex] = values.map(value => {
			const topic = encodeNormalizedTopics(withAlternatives(new Map([...defaults, [selectionIndex, value]])))[topicIndex]
			if (topic === undefined || topic === null) throw new Error(`Event topic ${topicIndex.toString()} could not be encoded for ${input.name ?? 'indexed input'}`)
			return ensure0x(topic)
		})
	}
	return topics
}

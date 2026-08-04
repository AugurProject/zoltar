import type { AbiParameter } from './types'

function findMatchingParenthesis(value: string, openingIndex: number) {
	let depth = 0
	for (let index = openingIndex; index < value.length; ++index) {
		const character = value[index]
		if (character === '(') {
			depth += 1
			continue
		}
		if (character !== ')') continue
		depth -= 1
		if (depth === 0) return index
	}
	throw new Error(`Unable to parse ABI item: ${value}`)
}

function splitTopLevelCommaSeparated(value: string) {
	const entries: string[] = []
	let current = ''
	let depth = 0
	for (const character of value) {
		if (character === '(') {
			depth += 1
			current += character
			continue
		}
		if (character === ')') {
			depth -= 1
			if (depth < 0) throw new Error(`Unable to parse ABI item: ${value}`)
			current += character
			continue
		}
		if (character === ',' && depth === 0) {
			const trimmedEntry = current.trim()
			if (trimmedEntry !== '') entries.push(trimmedEntry)
			current = ''
			continue
		}
		current += character
	}
	if (depth !== 0) throw new Error(`Unable to parse ABI item: ${value}`)
	const finalEntry = current.trim()
	if (finalEntry !== '') entries.push(finalEntry)
	return entries
}

function canonicalizeHumanReadableAbiType(type: string) {
	const typeMatch = /^(?<baseType>[^\[]+)(?<arraySuffix>(?:\[[0-9]*\])*)$/u.exec(type)
	if (typeMatch === null) return type
	const baseType = typeMatch.groups?.['baseType']
	const arraySuffix = typeMatch.groups?.['arraySuffix'] ?? ''
	if (baseType === undefined) return type
	const canonicalBaseType = (() => {
		if (baseType === 'uint') return 'uint256'
		if (baseType === 'int') return 'int256'
		if (baseType === 'byte') return 'bytes1'
		if (baseType === 'fixed') return 'fixed128x18'
		if (baseType === 'ufixed') return 'ufixed128x18'
		return baseType
	})()
	return `${canonicalBaseType}${arraySuffix}`
}

function parseAbiParameterEntry(entry: string): AbiParameter {
	const trimmedEntry = entry.trim()
	if (trimmedEntry === '') throw new Error(`Unable to parse ABI parameter: ${entry}`)
	const indexed = /(?:^|\s)indexed(?:\s|$)/u.test(trimmedEntry)
	const sanitizedEntry = trimmedEntry
		.replace(/\b(?:indexed|memory|calldata|storage)\b/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()

	if (/^(?:tuple\s*)?\(/u.test(sanitizedEntry)) {
		const openingIndex = sanitizedEntry.indexOf('(')
		const closingIndex = findMatchingParenthesis(sanitizedEntry, openingIndex)
		const componentsSource = sanitizedEntry.slice(openingIndex + 1, closingIndex)
		const trailingSource = sanitizedEntry.slice(closingIndex + 1).trim()
		const tupleMatch = /^(?<arraySuffix>(?:\[[0-9]*\])*)(?:\s*(?<name>[A-Za-z_][A-Za-z0-9_]*))?$/u.exec(trailingSource)
		if (tupleMatch === null) throw new Error(`Unable to parse ABI parameter: ${entry}`)
		const arraySuffix = tupleMatch.groups?.['arraySuffix'] ?? ''
		const name = tupleMatch.groups?.['name']
		return {
			...(indexed ? { indexed } : {}),
			...(name === undefined ? {} : { name }),
			components: parseParameterList(componentsSource),
			type: `tuple${arraySuffix}`,
		}
	}

	const parameterMatch = /^(?<type>\S+)(?:\s+(?<name>[A-Za-z_][A-Za-z0-9_]*))?$/u.exec(sanitizedEntry)
	if (parameterMatch === null) throw new Error(`Unable to parse ABI parameter: ${entry}`)
	const type = parameterMatch.groups?.['type']
	const name = parameterMatch.groups?.['name']
	if (type === undefined) throw new Error(`Unable to parse ABI parameter: ${entry}`)
	return {
		...(indexed ? { indexed } : {}),
		...(name === undefined ? {} : { name }),
		type: canonicalizeHumanReadableAbiType(type),
	}
}

function parseParameterList(value: string) {
	if (value.trim() === '') return []
	return splitTopLevelCommaSeparated(value).map<AbiParameter>(parseAbiParameterEntry)
}

export function parseAbiParameters(value: string) {
	return parseParameterList(value)
}

export function parseAbiItem(value: string) {
	const trimmed = value.trim()
	const functionHeaderMatch = /^function\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(trimmed)
	if (functionHeaderMatch !== null) {
		const name = functionHeaderMatch.groups?.['name']
		if (name === undefined) throw new Error(`Unsupported ABI item string: ${value}`)
		const inputsOpeningIndex = trimmed.indexOf('(', functionHeaderMatch[0].length - 1)
		const inputsClosingIndex = findMatchingParenthesis(trimmed, inputsOpeningIndex)
		const inputSource = trimmed.slice(inputsOpeningIndex + 1, inputsClosingIndex)
		const trailingSource = trimmed.slice(inputsClosingIndex + 1).trim()
		const returnsMatch = /\breturns\s*\(/u.exec(trailingSource)
		const modifiersSource = returnsMatch === null ? trailingSource : trailingSource.slice(0, returnsMatch.index).trim()
		const stateMutability = ['pure', 'view', 'payable', 'nonpayable'].find(candidate => new RegExp(`(?:^|\\s)${candidate}(?:\\s|$)`, 'u').test(modifiersSource))
		const unsupportedModifiers = modifiersSource
			.replace(/\b(?:external|public|internal|private|pure|view|payable|nonpayable)\b/gu, ' ')
			.replace(/\s+/gu, ' ')
			.trim()
		if (unsupportedModifiers !== '') throw new Error(`Unsupported ABI item string: ${value}`)

		const outputs = (() => {
			if (returnsMatch === null) return []
			const returnsOpeningIndex = trailingSource.indexOf('(', returnsMatch.index)
			const returnsClosingIndex = findMatchingParenthesis(trailingSource, returnsOpeningIndex)
			const trailingAfterReturns = trailingSource.slice(returnsClosingIndex + 1).trim()
			if (trailingAfterReturns !== '') throw new Error(`Unsupported ABI item string: ${value}`)
			return parseParameterList(trailingSource.slice(returnsOpeningIndex + 1, returnsClosingIndex))
		})()
		return {
			inputs: parseParameterList(inputSource),
			name,
			outputs,
			...(stateMutability === undefined ? {} : { stateMutability }),
			type: 'function',
		} satisfies AbiParameter
	}
	const eventHeaderMatch = /^event\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(trimmed)
	if (eventHeaderMatch !== null) {
		const name = eventHeaderMatch.groups?.['name']
		if (name === undefined) throw new Error(`Unsupported ABI item string: ${value}`)
		const inputsOpeningIndex = trimmed.indexOf('(', eventHeaderMatch[0].length - 1)
		const inputsClosingIndex = findMatchingParenthesis(trimmed, inputsOpeningIndex)
		const inputSource = trimmed.slice(inputsOpeningIndex + 1, inputsClosingIndex)
		const trailingSource = trimmed.slice(inputsClosingIndex + 1).trim()
		if (trailingSource !== '' && trailingSource !== 'anonymous') throw new Error(`Unsupported ABI item string: ${value}`)
		return {
			...(trailingSource === 'anonymous' ? { anonymous: true } : {}),
			inputs: parseParameterList(inputSource),
			name,
			type: 'event',
		} satisfies AbiParameter
	}
	throw new Error(`Unsupported ABI item string: ${value}`)
}

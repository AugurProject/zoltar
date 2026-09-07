import { readFileSync } from 'node:fs'
import { contractSafetyPolicy, type BytecodeBudget, type ContractReference } from './contract-safety-policy'

type ArtifactContract = {
	abi?: unknown[]
	evm?: {
		bytecode?: { object?: string }
		deployedBytecode?: { object?: string }
	}
	storageLayout?: {
		storage?: unknown[]
		types?: Record<string, unknown>
	}
}

type ContractArtifact = {
	contracts?: Record<string, Record<string, ArtifactContract>>
}

export type ContractSize = ContractReference & {
	creationBytes: number
	initcodeBytes: number
	runtimeBytes: number
}

export type ContractSafetyResult = {
	sizes: ContractSize[]
	errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function getString(value: unknown, message: string): string {
	if (typeof value !== 'string') throw new Error(message)
	return value
}

function getNumber(value: unknown, message: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(message)
	return value
}

function byteLength(bytecode: string, label: string): number {
	const normalized = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode
	if (normalized.length % 2 !== 0) throw new Error(`${label} has odd-length bytecode`)
	return normalized.length / 2
}

function contractId(reference: ContractReference): string {
	return `${reference.sourcePath}:${reference.contractName}`
}

type AbiParameter = {
	type: string
	components?: AbiParameter[]
}

function getAbiParameter(value: unknown, label: string): AbiParameter {
	if (!isRecord(value) || typeof value['type'] !== 'string') throw new Error(`${label} is not a valid ABI parameter`)
	if (value['components'] !== undefined && !Array.isArray(value['components'])) throw new Error(`${label} components must be an array`)
	return {
		type: value['type'],
		components: Array.isArray(value['components']) ? value['components'].map((component, index) => getAbiParameter(component, `${label} component ${index}`)) : undefined,
	}
}

function splitArrayType(type: string): { elementType: string; length: number | undefined } | undefined {
	const match = /^(.*)\[([0-9]*)\]$/.exec(type)
	if (match === null) return undefined
	const elementType = match[1]
	const lengthText = match[2]
	if (elementType === undefined || lengthText === undefined) throw new Error(`Invalid ABI array type ${type}`)
	return { elementType, length: lengthText === '' ? undefined : Number.parseInt(lengthText, 10) }
}

function withType(parameter: AbiParameter, type: string): AbiParameter {
	return { type, components: parameter.components }
}

function isDynamicAbiParameter(parameter: AbiParameter): boolean {
	if (parameter.type === 'bytes' || parameter.type === 'string') return true
	const array = splitArrayType(parameter.type)
	if (array !== undefined) return array.length === undefined || isDynamicAbiParameter(withType(parameter, array.elementType))
	if (parameter.type === 'tuple') return (parameter.components ?? []).some(isDynamicAbiParameter)
	return false
}

function staticAbiSize(parameter: AbiParameter): number {
	const array = splitArrayType(parameter.type)
	if (array !== undefined) {
		if (array.length === undefined) throw new Error(`Dynamic ABI type ${parameter.type} has no static size`)
		return array.length * staticAbiSize(withType(parameter, array.elementType))
	}
	if (parameter.type === 'tuple') return (parameter.components ?? []).reduce((total, component) => total + staticAbiSize(component), 0)
	return 32
}

function minimumDynamicPayloadSize(parameter: AbiParameter): number {
	if (parameter.type === 'bytes' || parameter.type === 'string') return 32
	const array = splitArrayType(parameter.type)
	if (array !== undefined) {
		if (array.length === undefined) return 32
		return minimumTupleEncodingSize(Array.from({ length: array.length }, () => withType(parameter, array.elementType)))
	}
	if (parameter.type === 'tuple') return minimumTupleEncodingSize(parameter.components ?? [])
	throw new Error(`Static ABI type ${parameter.type} has no dynamic payload`)
}

function minimumTupleEncodingSize(parameters: readonly AbiParameter[]): number {
	return parameters.reduce((total, parameter) => total + (isDynamicAbiParameter(parameter) ? 32 + minimumDynamicPayloadSize(parameter) : staticAbiSize(parameter)), 0)
}

function minimumConstructorArgumentsBytes(contract: ArtifactContract, label: string): number {
	const constructor = contract.abi?.find(entry => isRecord(entry) && entry['type'] === 'constructor')
	if (constructor === undefined) return 0
	if (!isRecord(constructor) || !Array.isArray(constructor['inputs'])) throw new Error(`${label} constructor ABI is missing inputs`)
	return minimumTupleEncodingSize(constructor['inputs'].map((input, index) => getAbiParameter(input, `${label} constructor input ${index}`)))
}

function getContract(artifact: ContractArtifact, reference: ContractReference): ArtifactContract {
	const sourceContracts = artifact.contracts?.[reference.sourcePath]
	if (sourceContracts === undefined) throw new Error(`Missing compiler output for ${reference.sourcePath}`)
	const contract = sourceContracts[reference.contractName]
	if (contract === undefined) throw new Error(`Missing compiler output for ${contractId(reference)}`)
	return contract
}

function normalizeType(typeId: string, types: Record<string, unknown>, activeTypeIds = new Set<string>()): unknown {
	if (activeTypeIds.has(typeId)) return { recursiveType: typeId }
	const rawType = types[typeId]
	if (!isRecord(rawType)) throw new Error(`Missing storage type ${typeId}`)
	const nextActiveTypeIds = new Set(activeTypeIds)
	nextActiveTypeIds.add(typeId)
	const normalized: Record<string, unknown> = {
		encoding: getString(rawType['encoding'], `Storage type ${typeId} is missing encoding`),
		label: getString(rawType['label'], `Storage type ${typeId} is missing label`),
		numberOfBytes: getString(rawType['numberOfBytes'], `Storage type ${typeId} is missing byte width`),
	}
	for (const relation of ['key', 'value', 'base'] as const) {
		if (typeof rawType[relation] === 'string') normalized[relation] = normalizeType(rawType[relation], types, nextActiveTypeIds)
	}
	if (Array.isArray(rawType['members'])) {
		normalized['members'] = rawType['members'].map((member, index) => {
			if (!isRecord(member)) throw new Error(`Invalid member ${index} of storage type ${typeId}`)
			return {
				label: getString(member['label'], `Storage member ${index} of ${typeId} is missing a label`),
				offset: getNumber(member['offset'], `Storage member ${index} of ${typeId} has an invalid offset`),
				slot: getString(member['slot'], `Storage member ${index} of ${typeId} is missing a slot`),
				type: normalizeType(getString(member['type'], `Storage member ${index} of ${typeId} is missing a type`), types, nextActiveTypeIds),
			}
		})
	}
	return normalized
}

function normalizeStorageLayout(contract: ArtifactContract): unknown[] {
	const layout = contract.storageLayout
	if (layout === undefined || !Array.isArray(layout.storage) || !isRecord(layout.types)) throw new Error('Contract output is missing a complete storage layout')
	return layout.storage.map((entry, index) => {
		if (!isRecord(entry)) throw new Error(`Invalid storage entry ${index}`)
		return {
			label: getString(entry['label'], `Storage entry ${index} is missing a label`),
			offset: getNumber(entry['offset'], `Storage entry ${index} has an invalid offset`),
			slot: getString(entry['slot'], `Storage entry ${index} is missing a slot`),
			type: normalizeType(getString(entry['type'], `Storage entry ${index} is missing a type`), layout.types),
		}
	})
}

function findBudget(budgets: readonly BytecodeBudget[], size: ContractSize): BytecodeBudget | undefined {
	return budgets.find(budget => budget.sourcePath === size.sourcePath && budget.contractName === size.contractName)
}

export function collectDeployableContractSizes(artifact: ContractArtifact): ContractSize[] {
	const sizes: ContractSize[] = []
	for (const [sourcePath, contracts] of Object.entries(artifact.contracts ?? {})) {
		if (contractSafetyPolicy.excludedSourcePrefixes.some(prefix => sourcePath.startsWith(prefix))) continue
		for (const [contractName, contract] of Object.entries(contracts)) {
			const initcode = contract.evm?.bytecode?.object ?? ''
			if (initcode.length === 0) continue
			const label = `${sourcePath}:${contractName}`
			const creationBytes = byteLength(initcode, `${label} creation bytecode`)
			sizes.push({
				sourcePath,
				contractName,
				creationBytes,
				initcodeBytes: creationBytes + minimumConstructorArgumentsBytes(contract, label),
				runtimeBytes: byteLength(contract.evm?.deployedBytecode?.object ?? '', `${label} runtime`),
			})
		}
	}
	return sizes.sort((left, right) => right.runtimeBytes - left.runtimeBytes || contractId(left).localeCompare(contractId(right)))
}

export function checkContractSafety(artifact: ContractArtifact): ContractSafetyResult {
	const sizes = collectDeployableContractSizes(artifact)
	const errors: string[] = []
	for (const size of sizes) {
		const id = contractId(size)
		if (size.runtimeBytes > contractSafetyPolicy.runtimeLimitBytes) {
			errors.push(`${id} runtime is ${size.runtimeBytes} bytes; EIP-170 limit is ${contractSafetyPolicy.runtimeLimitBytes}`)
		}
		if (size.initcodeBytes > contractSafetyPolicy.initcodeLimitBytes) {
			errors.push(`${id} initcode is ${size.initcodeBytes} bytes; EIP-3860 limit is ${contractSafetyPolicy.initcodeLimitBytes}`)
		}
		const runtimeBudget = findBudget(contractSafetyPolicy.runtimeBudgets, size)
		if (runtimeBudget !== undefined && size.runtimeBytes > runtimeBudget.maximumBytes) {
			errors.push(`${id} runtime grew to ${size.runtimeBytes} bytes; reviewed budget is ${runtimeBudget.maximumBytes} (${runtimeBudget.reason})`)
		}
		const initcodeBudget = findBudget(contractSafetyPolicy.initcodeBudgets, size)
		if (initcodeBudget !== undefined && size.initcodeBytes > initcodeBudget.maximumBytes) {
			errors.push(`${id} initcode grew to ${size.initcodeBytes} bytes; reviewed budget is ${initcodeBudget.maximumBytes} (${initcodeBudget.reason})`)
		}
	}

	for (const pair of contractSafetyPolicy.exactLayoutPairs) {
		try {
			const hostLayout = normalizeStorageLayout(getContract(artifact, pair.host))
			const delegateLayout = normalizeStorageLayout(getContract(artifact, pair.delegate))
			if (JSON.stringify(hostLayout) !== JSON.stringify(delegateLayout)) {
				errors.push(`${contractId(pair.delegate)} storage layout differs from delegatecall host ${contractId(pair.host)} (${pair.reason})`)
			}
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error))
		}
	}

	for (const anchoredLayout of contractSafetyPolicy.anchoredLayouts) {
		try {
			const hostLayout = normalizeStorageLayout(getContract(artifact, anchoredLayout.host))
			for (const anchor of anchoredLayout.anchors) {
				const entry = hostLayout.find(candidate => isRecord(candidate) && candidate['label'] === anchor.label)
				if (!isRecord(entry) || !isRecord(entry['type'])) {
					errors.push(`${contractId(anchoredLayout.host)} is missing ${anchor.label}, required by ${contractId(anchoredLayout.consumer)}`)
					continue
				}
				const actual = { slot: entry['slot'], offset: entry['offset'], typeLabel: entry['type']['label'] }
				const expected = { slot: anchor.slot, offset: anchor.offset, typeLabel: anchor.typeLabel }
				if (JSON.stringify(actual) !== JSON.stringify(expected)) {
					errors.push(`${contractId(anchoredLayout.host)}.${anchor.label} is ${JSON.stringify(actual)}; ${contractId(anchoredLayout.consumer)} requires ${JSON.stringify(expected)} (${anchoredLayout.reason})`)
				}
			}
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error))
		}
	}

	return { sizes, errors }
}

export function loadContractArtifact(filePath: string): ContractArtifact {
	const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
	if (!isRecord(parsed)) throw new Error(`${filePath} must contain an object`)
	return parsed
}

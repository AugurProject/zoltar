import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex as nobleBytesToHex, concatBytes, hexToBytes as nobleHexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { addr, amounts, eip191Signer, Transaction as MicroTransaction } from 'micro-eth-signer';
import { Decoder, createContract, deployContract, events } from 'micro-eth-signer/advanced/abi.js';
export class RpcError extends Error {
    code;
    cause;
    shortMessage;
    constructor(message, options = {}) {
        super(message);
        this.name = 'RpcError';
        this.code = options.code;
        this.cause = options.cause;
        this.shortMessage = options.shortMessage;
    }
}
class ContractFunctionError extends Error {
    constructor(name, message, cause) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = name;
    }
}
export const zeroAddress = getAddress('0x0000000000000000000000000000000000000000');
export const zeroHash = `0x${'00'.repeat(32)}`;
export const maxUint256 = amounts.maxUint256;
const DEFAULT_RATE_LIMIT_RETRY_COUNT = 3;
export const RATE_LIMIT_RETRY_DELAY_MILLISECONDS = 10_000;
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
};
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
];
export const mainnet = MAINNET_CHAIN;
export function defineChain(chain) {
    return chain;
}
function stripHexPrefix(value) {
    return value.startsWith('0x') ? value.slice(2) : value;
}
function ensure0x(value) {
    return (value.startsWith('0x') ? value : `0x${value}`);
}
function ensureEvenHex(value) {
    return value.length % 2 === 0 ? value : `0${value}`;
}
function isHexCharacter(value) {
    return /^[0-9a-fA-F]*$/.test(value);
}
function normalizeQuantityValue(value) {
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0)
            throw new Error(`Number "${value.toString()}" is not in safe integer range`);
        return BigInt(value);
    }
    if (value < 0n)
        throw new Error(`Number "${value.toString()}n" is not in safe integer range`);
    return value;
}
export function bigintToSafeNumber(value, label = 'Value') {
    if (value < -9007199254740991n || value > 9007199254740991n)
        throw new Error(`${label} exceeds the JavaScript safe integer range`);
    return Number.parseInt(value.toString(), 10);
}
function hexQuantity(value) {
    const normalized = normalizeQuantityValue(value);
    return normalized === 0n ? '0x0' : ensure0x(normalized.toString(16));
}
function normalizeHexData(value) {
    if (value === undefined)
        return undefined;
    if (!isHex(value, { strict: true }))
        throw new Error(`Invalid hex value: ${value}`);
    return ensure0x(ensureEvenHex(stripHexPrefix(value).toLowerCase()));
}
function normalizeOptionalLogRemoved(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'boolean')
        throw new Error('RPC returned a log with an invalid removed flag');
    return value;
}
function normalizeTransactionType(value) {
    if (typeof value !== 'string')
        return undefined;
    switch (value) {
        case '0x0':
            return 'legacy';
        case '0x1':
            return 'eip2930';
        case '0x2':
            return 'eip1559';
        case '0x3':
            return 'eip4844';
        case '0x4':
            return 'eip7702';
        default:
            return value;
    }
}
function normalizeBlockTag(value) {
    return value === undefined ? 'latest' : hexQuantity(value);
}
function normalizeNullableAddress(value) {
    if (value === null || value === undefined)
        return undefined;
    if (typeof value !== 'string')
        throw new Error('RPC returned an invalid address');
    if (value === '0x')
        return undefined;
    return getAddress(value);
}
function normalizeAddress(value) {
    const normalized = normalizeNullableAddress(value);
    if (normalized === undefined)
        throw new Error('RPC returned an invalid address');
    return normalized;
}
function normalizeHash(value) {
    if (typeof value !== 'string' || !isHex(value, { strict: true }))
        throw new Error('RPC returned an invalid hash');
    const normalized = stripHexPrefix(value).toLowerCase();
    if (normalized.length !== 64)
        throw new Error('RPC returned an invalid hash');
    return ensure0x(normalized);
}
function requireMatchingTransactionHash(expected, actual, resultLabel) {
    if (actual !== expected)
        throw new Error(`RPC returned ${resultLabel} with a different hash: expected "${expected}", received "${actual}"`);
}
function normalizeRpcHex(value) {
    if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value))
        throw new Error('RPC returned an invalid hex value');
    return ensure0x(stripHexPrefix(value).toLowerCase());
}
function normalizeRpcBigInt(value, fallback = 0n) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value === 'bigint') {
        if (value < 0n)
            throw new Error('RPC returned an invalid bigint value');
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0)
            throw new Error('RPC returned an invalid bigint value');
        return BigInt(value);
    }
    if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value))
        throw new Error('RPC returned an invalid bigint value');
    return BigInt(value);
}
function normalizeRequiredRpcBigInt(value, label) {
    if (value === undefined || value === null)
        throw new Error(`RPC returned a missing required ${label}`);
    return normalizeRpcBigInt(value);
}
function normalizeRequiredReceiptQuantity(value, field) {
    if (value === undefined || value === null)
        throw new Error(`RPC returned a transaction receipt without required ${field}`);
    return normalizeRpcBigInt(value);
}
function normalizeReceiptStatus(value) {
    if (value === '0x1')
        return 'success';
    if (value === '0x0')
        return 'reverted';
    throw new Error('RPC returned a transaction receipt without a valid status');
}
function normalizeInputValues(values) {
    return values === undefined ? [] : [...values];
}
function isStaticBytesAbiType(type) {
    return /^bytes\d+$/u.test(type);
}
function normalizeCodecValue(parameter, value) {
    const arrayItemType = getArrayItemType(parameter.type);
    if (arrayItemType !== undefined) {
        if (!Array.isArray(value))
            return value;
        return value.map(item => normalizeCodecValue({ ...parameter, type: arrayItemType }, item));
    }
    if (parameter.type.startsWith('tuple')) {
        const components = parameter.components ?? [];
        const allNamed = components.every(component => component.name !== undefined && component.name !== '');
        if (Array.isArray(value)) {
            if (!allNamed) {
                return value.map((item, index) => {
                    const component = components[index];
                    return component === undefined ? item : normalizeCodecValue(component, item);
                });
            }
            return Object.fromEntries(components.map((component, index) => {
                const name = component.name;
                if (name === undefined || name === '')
                    throw new Error('ABI tuple component name is missing');
                return [name, normalizeCodecValue(component, value[index])];
            }));
        }
        if (typeof value !== 'object' || value === null)
            return value;
        if (!allNamed) {
            return components.map((component, index) => normalizeCodecValue(component, Reflect.get(value, index.toString())));
        }
        return Object.fromEntries(components.map(component => {
            const name = component.name;
            if (name === undefined || name === '')
                throw new Error('ABI tuple component name is missing');
            return [name, normalizeCodecValue(component, Reflect.get(value, name))];
        }));
    }
    if ((parameter.type === 'bytes' || isStaticBytesAbiType(parameter.type)) && typeof value === 'string' && isHex(value, { strict: true })) {
        return abiHexToBytes(value);
    }
    return value;
}
function abiHexToBytes(value) {
    const stripped = stripHexPrefix(value);
    return nobleHexToBytes(stripped.length % 2 === 0 ? stripped : `${stripped}0`);
}
function normalizeCodecArguments(parameters, values) {
    const normalizedValues = normalizeInputValues(values);
    const resolvedParameters = parameters ?? [];
    if (resolvedParameters.length === 0)
        return normalizedValues;
    if (resolvedParameters.length === 1) {
        const parameter = resolvedParameters[0];
        if (parameter === undefined)
            return normalizedValues[0];
        return normalizeCodecValue(parameter, normalizedValues[0]);
    }
    const allNamed = resolvedParameters.every(parameter => parameter.name !== undefined && parameter.name !== '');
    if (!allNamed) {
        return resolvedParameters.map((parameter, index) => normalizeCodecValue(parameter, normalizedValues[index]));
    }
    return Object.fromEntries(resolvedParameters.map((parameter, index) => {
        const name = parameter.name;
        if (name === undefined || name === '')
            throw new Error('ABI parameter name is missing');
        return [name, normalizeCodecValue(parameter, normalizedValues[index])];
    }));
}
function normalizeAbiParameterValue(value, context) {
    if (typeof value !== 'object' || value === null)
        throw new Error(`Invalid ${context}`);
    const parameter = value;
    const type = parameter['type'];
    if (typeof type !== 'string')
        throw new Error(`Invalid ${context}`);
    const normalizeChildParameters = (children, propertyName) => {
        if (!Array.isArray(children))
            throw new Error(`Invalid ${context}.${propertyName}`);
        return children.map((child, index) => normalizeAbiParameterValue(child, `${context}.${propertyName}[${index.toString()}]`));
    };
    return {
        ...(typeof parameter['anonymous'] === 'boolean' ? { anonymous: parameter['anonymous'] } : {}),
        ...(parameter['components'] === undefined ? {} : { components: normalizeChildParameters(parameter['components'], 'components') }),
        ...(typeof parameter['indexed'] === 'boolean' ? { indexed: parameter['indexed'] } : {}),
        ...(parameter['inputs'] === undefined ? {} : { inputs: normalizeChildParameters(parameter['inputs'], 'inputs') }),
        ...(typeof parameter['name'] === 'string' ? { name: parameter['name'] } : {}),
        ...(parameter['outputs'] === undefined ? {} : { outputs: normalizeChildParameters(parameter['outputs'], 'outputs') }),
        ...(typeof parameter['stateMutability'] === 'string' ? { stateMutability: parameter['stateMutability'] } : {}),
        type,
    };
}
function normalizeAbi(abi) {
    return abi.map((entry, index) => normalizeAbiParameterValue(entry, `abi[${index.toString()}]`));
}
function getArrayItemType(type) {
    const match = /^(.*)\[(?:\d*)\]$/u.exec(type);
    return match?.[1];
}
function isIntegerAbiType(type) {
    return /^u?int(?:\d+)?$/u.test(type);
}
function normalizeDecodedTuple(components, value) {
    if (Array.isArray(value)) {
        const normalized = value.map((item, index) => {
            const component = components[index];
            return component === undefined ? item : normalizeDecodedValue(component, item);
        });
        if (components.length === 0 || components.some(component => component.name === undefined || component.name === ''))
            return normalized;
        for (const [index, component] of components.entries()) {
            if (component.name === undefined || component.name === '')
                throw new Error('Decoded tuple alias eligibility changed during normalization');
            if (component.name in normalized || /^(?:0|[1-9]\d*)$/u.test(component.name))
                continue;
            Object.defineProperty(normalized, component.name, {
                configurable: false,
                enumerable: false,
                value: normalized[index],
                writable: false,
            });
        }
        return normalized;
    }
    if (typeof value !== 'object' || value === null)
        return value;
    const tuple = value;
    const normalized = {};
    for (const [key, currentValue] of Object.entries(tuple)) {
        const componentByIndex = /^\d+$/u.test(key) ? components[Number(key)] : undefined;
        const componentByName = componentByIndex ?? components.find(component => component.name === key);
        normalized[key] = componentByName === undefined ? currentValue : normalizeDecodedValue(componentByName, currentValue);
    }
    return normalized;
}
function normalizeDecodedValue(parameter, value) {
    const arrayItemType = getArrayItemType(parameter.type);
    if (arrayItemType !== undefined) {
        if (!Array.isArray(value))
            return value;
        return value.map(item => normalizeDecodedValue({ ...parameter, type: arrayItemType }, item));
    }
    if (parameter.type.startsWith('tuple')) {
        return normalizeDecodedTuple(parameter.components ?? [], value);
    }
    if (isIntegerAbiType(parameter.type)) {
        if (typeof value === 'number')
            return BigInt(value);
        return value;
    }
    if (parameter.type === 'address' && typeof value === 'string' && isAddress(value))
        return getAddress(value);
    if (parameter.type.startsWith('bytes') && value instanceof Uint8Array)
        return bytesToHex(value);
    if (parameter.type.startsWith('bytes') && typeof value === 'string' && isHex(value, { strict: true }))
        return normalizeRpcHex(value);
    return value;
}
function normalizeDecodedArguments(parameters, value) {
    if (parameters.length === 0)
        return [];
    if (parameters.length === 1) {
        const parameter = parameters[0];
        if (parameter === undefined)
            return [value];
        return [normalizeDecodedValue(parameter, value)];
    }
    return normalizeDecodeFunctionArgs(value).map((item, index) => {
        const parameter = parameters[index];
        return parameter === undefined ? item : normalizeDecodedValue(parameter, item);
    });
}
function normalizeDecodedFunctionOutput(abiItem, value) {
    const outputs = abiItem.outputs ?? [];
    if (outputs.length === 0)
        return undefined;
    if (outputs.length === 1) {
        const output = outputs[0];
        if (output === undefined)
            return value;
        return normalizeDecodedValue(output, value);
    }
    return normalizeDecodedTuple(outputs, value);
}
function cloneAbiParameter(parameter, options) {
    const nameProperties = (() => {
        if (options.stripName)
            return {};
        if (parameter.name === undefined)
            return {};
        return { name: parameter.name };
    })();
    return {
        ...nameProperties,
        ...(parameter.anonymous === undefined ? {} : { anonymous: parameter.anonymous }),
        ...(parameter.indexed === undefined ? {} : { indexed: parameter.indexed }),
        ...(parameter.inputs === undefined ? {} : { inputs: parameter.inputs.map((input) => cloneAbiParameter(input, { stripName: false })) }),
        ...(parameter.outputs === undefined ? {} : { outputs: parameter.outputs.map((output) => cloneAbiParameter(output, { stripName: false })) }),
        ...(parameter.components === undefined ? {} : { components: parameter.components.map((component) => cloneAbiParameter(component, { stripName: false })) }),
        ...(parameter.stateMutability === undefined ? {} : { stateMutability: parameter.stateMutability }),
        type: parameter.type,
    };
}
function normalizeFunctionAbiForCodec(abiItem) {
    return {
        ...(abiItem.name === undefined ? {} : { name: abiItem.name }),
        ...(abiItem.inputs === undefined
            ? {}
            : {
                inputs: abiItem.inputs.map((input) => cloneAbiParameter(input, { stripName: true })),
            }),
        ...(abiItem.outputs === undefined
            ? {}
            : {
                outputs: abiItem.outputs.map((output, _index, outputs) => cloneAbiParameter(output, { stripName: outputs.length !== 1 || !output.type.startsWith('tuple') })),
            }),
        ...(abiItem.stateMutability === undefined ? {} : { stateMutability: abiItem.stateMutability }),
        type: abiItem.type,
    };
}
function normalizeFunctionAbiForEncoder(abiItem) {
    return {
        ...(abiItem.name === undefined ? {} : { name: abiItem.name }),
        ...(abiItem.inputs === undefined
            ? {}
            : {
                inputs: abiItem.inputs.map((input) => cloneAbiParameter(input, { stripName: false })),
            }),
        ...(abiItem.outputs === undefined
            ? {}
            : {
                outputs: abiItem.outputs.map((output, _index, outputs) => cloneAbiParameter(output, { stripName: outputs.length !== 1 || !output.type.startsWith('tuple') })),
            }),
        ...(abiItem.stateMutability === undefined ? {} : { stateMutability: abiItem.stateMutability }),
        type: abiItem.type,
    };
}
function getNamedFunctionAbi(abi, functionName, args) {
    const normalizedAbi = normalizeAbi(abi);
    const signatureMatch = normalizedAbi.find((entry) => entry.type === 'function' && getAbiSignature(entry) === functionName);
    if (signatureMatch !== undefined)
        return signatureMatch;
    const matchingEntries = normalizedAbi.filter((entry) => entry.type === 'function' && entry.name === functionName);
    if (matchingEntries.length === 0) {
        throw new Error(`Function "${functionName}" was not found in the ABI`);
    }
    if (matchingEntries.length === 1) {
        const onlyEntry = matchingEntries[0];
        if (onlyEntry === undefined)
            throw new Error(`Function "${functionName}" was not found in the ABI`);
        return onlyEntry;
    }
    const argumentCount = args?.length ?? 0;
    const arityMatches = matchingEntries.filter((entry) => (entry.inputs?.length ?? 0) === argumentCount);
    if (arityMatches.length === 1) {
        const arityMatch = arityMatches[0];
        if (arityMatch === undefined)
            throw new Error(`Function "${functionName}" was not found in the ABI`);
        return arityMatch;
    }
    if (arityMatches.length > 1) {
        const compatibleMatches = arityMatches.filter((entry) => canEncodeFunctionArguments(entry, args));
        if (compatibleMatches.length === 1) {
            const compatibleMatch = compatibleMatches[0];
            if (compatibleMatch === undefined)
                throw new Error(`Function "${functionName}" was not found in the ABI`);
            return compatibleMatch;
        }
        if (compatibleMatches.length > 1) {
            throw new Error(`Function "${functionName}" is overloaded and remained ambiguous for the provided argument shape`);
        }
    }
    throw new Error(`Function "${functionName}" is overloaded and could not be resolved from ${argumentCount.toString()} arguments`);
}
function canEncodeFunctionArguments(abiItem, args) {
    try {
        const method = getContractMethod(abiItem);
        method.encodeInput(normalizeCodecArguments(abiItem.inputs, args));
        return true;
    }
    catch (error) {
        if (error instanceof Error)
            return false;
        return false;
    }
}
function getNamedEventAbi(abi, eventName) {
    for (const entry of normalizeAbi(abi)) {
        if (entry.type !== 'event')
            continue;
        if (entry.name === eventName)
            return entry;
    }
    throw new Error(`Event "${eventName}" was not found in the ABI`);
}
function getContractMethod(abiItem) {
    if (abiItem.name === undefined)
        throw new Error('ABI function is missing a name');
    const contract = createContract([normalizeFunctionAbiForEncoder(abiItem)]);
    const method = contract[abiItem.name];
    if (method === undefined)
        throw new Error(`Function "${abiItem.name}" could not be created`);
    return method;
}
function normalizeDecodeFunctionArgs(value) {
    if (value === undefined)
        return [];
    return Array.isArray(value) ? value : [value];
}
function decodeFunctionOutput(abiItem, data) {
    try {
        const method = getContractMethod(abiItem);
        return normalizeDecodedFunctionOutput(abiItem, method.decodeOutput(nobleHexToBytes(stripHexPrefix(data))));
    }
    catch (cause) {
        const error = new Error(`Unable to decode ${abiItem.name ?? 'contract function'} result`, { cause });
        error.name = 'AbiDecodingError';
        throw error;
    }
}
function rlpEncodeBytes(value) {
    if (value.length === 1 && value[0] !== undefined && value[0] < 0x80)
        return value;
    if (value.length <= 55)
        return concatBytes(Uint8Array.of(0x80 + value.length), value);
    const lengthBytes = bigintToBytes(BigInt(value.length));
    return concatBytes(Uint8Array.of(0xb7 + lengthBytes.length), lengthBytes, value);
}
function rlpEncodeList(items) {
    const payload = concatBytes(...items);
    if (payload.length <= 55)
        return concatBytes(Uint8Array.of(0xc0 + payload.length), payload);
    const lengthBytes = bigintToBytes(BigInt(payload.length));
    return concatBytes(Uint8Array.of(0xf7 + lengthBytes.length), lengthBytes, payload);
}
function bigintToBytes(value) {
    if (value === 0n)
        return new Uint8Array([]);
    let hex = value.toString(16);
    hex = ensureEvenHex(hex);
    return nobleHexToBytes(hex);
}
function checksumAddressFromBytes(value) {
    return getAddress(ensure0x(nobleBytesToHex(value).slice(-40)));
}
function normalizeEventTopicArgs(eventAbi, args) {
    const inputs = eventAbi.inputs ?? [];
    const hasNames = inputs.every((input) => input.name !== undefined);
    const normalizeTopicValue = (input, value) => {
        if (value === null || value === undefined)
            return null;
        if (input.type === 'bytes' && typeof value === 'string' && isHex(value, { strict: true }))
            return hexToBytes(value);
        return normalizeCodecValue(input, value);
    };
    if (args === undefined) {
        if (hasNames) {
            return Object.fromEntries(inputs.map((input) => [input.name, null]));
        }
        return inputs.map(() => null);
    }
    if (!hasNames || Array.isArray(args)) {
        let indexedInputIndex = 0;
        const usesFullInputArray = Array.isArray(args) && args.length === inputs.length;
        return inputs.map((input, inputIndex) => {
            if (input.indexed !== true)
                return null;
            const value = Array.isArray(args) ? args[usesFullInputArray ? inputIndex : indexedInputIndex] : undefined;
            indexedInputIndex += 1;
            return normalizeTopicValue(input, value);
        });
    }
    return Object.fromEntries(inputs.map(input => {
        const name = input.name;
        if (name === undefined)
            throw new Error('ABI event input name is missing');
        return [name, input.indexed === true ? normalizeTopicValue(input, Reflect.get(args, name)) : null];
    }));
}
function eventTopicWildcardPlaceholder(input) {
    const arrayMatch = /^(.*)\[(\d*)\]$/u.exec(input.type);
    if (arrayMatch !== null) {
        const itemType = arrayMatch[1];
        const lengthText = arrayMatch[2];
        if (itemType === undefined || lengthText === undefined || lengthText === '')
            return [];
        const length = Number(lengthText);
        if (!Number.isSafeInteger(length) || length < 0)
            throw new Error(`Invalid ABI array length ${lengthText}`);
        return Array.from({ length }, () => eventTopicWildcardPlaceholder({ ...input, type: itemType }));
    }
    if (input.type.startsWith('tuple')) {
        const components = input.components ?? [];
        const named = components.every(component => component.name !== undefined && component.name !== '');
        if (!named)
            return components.map(eventTopicWildcardPlaceholder);
        return Object.fromEntries(components.map(component => {
            const name = component.name;
            if (name === undefined || name === '')
                throw new Error('ABI tuple component name is missing');
            return [name, eventTopicWildcardPlaceholder(component)];
        }));
    }
    if (input.type === 'address')
        return zeroAddress;
    if (input.type === 'bool')
        return false;
    if (input.type === 'string')
        return '';
    if (input.type === 'bytes')
        return new Uint8Array();
    if (isStaticBytesAbiType(input.type)) {
        const size = Number(input.type.slice('bytes'.length));
        if (!Number.isSafeInteger(size) || size < 1 || size > 32)
            throw new Error(`Invalid ABI byte width ${input.type}`);
        return new Uint8Array(size);
    }
    if (isIntegerAbiType(input.type))
        return 0n;
    throw new Error(`Cannot construct a wildcard placeholder for indexed ABI type ${input.type}`);
}
function createDecodeError(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
}
function getEventDecoder(eventAbi) {
    if (eventAbi.name === undefined)
        throw new Error('ABI event is missing a name');
    const contractEvents = events([eventAbi]);
    const eventDecoder = contractEvents[eventAbi.name];
    if (eventDecoder === undefined)
        throw new Error(`Event "${eventAbi.name}" could not be created`);
    return eventDecoder;
}
function getAbiSignature(parameter) {
    if (parameter.type === 'function' || parameter.type === 'event') {
        return `${parameter.name ?? 'function'}(${(parameter.inputs ?? []).map((input) => getAbiSignature(input)).join(',')})`;
    }
    if (parameter.type.startsWith('tuple')) {
        return `(${(parameter.components ?? []).map((component) => getAbiSignature(component)).join(',')})${parameter.type.slice(5)}`;
    }
    return parameter.type;
}
export function formatAbiParameter(parameter) {
    const type = parameter.type.startsWith('tuple') ? `(${(parameter.components ?? []).map(formatAbiParameter).join(', ')})${parameter.type.slice(5)}` : parameter.type;
    return [type, parameter.indexed === true ? 'indexed' : undefined, parameter.name].filter((value) => value !== undefined && value !== '').join(' ');
}
export function formatAbiItem(parameter) {
    if (parameter.type !== 'event' && parameter.type !== 'function')
        return getAbiSignature(parameter);
    const inputs = (parameter.inputs ?? []).map(formatAbiParameter).join(', ');
    const outputs = parameter.type === 'function' && (parameter.outputs?.length ?? 0) > 0 ? ` returns (${(parameter.outputs ?? []).map(formatAbiParameter).join(', ')})` : '';
    const stateMutability = parameter.type === 'function' && parameter.stateMutability !== undefined && parameter.stateMutability !== 'nonpayable' ? ` ${parameter.stateMutability}` : '';
    const anonymous = parameter.type === 'event' && parameter.anonymous === true ? ' anonymous' : '';
    return `${parameter.type} ${parameter.name ?? ''}(${inputs})${stateMutability}${outputs}${anonymous}`;
}
export function toEventSelector(parameter) {
    if (parameter.type !== 'event')
        throw new Error('ABI item is not an event');
    return keccak256(getAbiSignature(parameter));
}
export function toFunctionSelector(parameter) {
    if (parameter.type !== 'function')
        throw new Error('ABI item is not a function');
    return `0x${keccak256(getAbiSignature(parameter)).slice(2, 10)}`;
}
function getEventSignatureHash(eventAbi) {
    return stripHexPrefix(keccak256(getAbiSignature(eventAbi))).toLowerCase();
}
function ensureConstructorAbi(abi) {
    const normalizedAbi = normalizeAbi(abi);
    return normalizedAbi.some(entry => entry.type === 'constructor')
        ? normalizedAbi
        : [
            ...normalizedAbi,
            {
                inputs: [],
                type: 'constructor',
            },
        ];
}
async function requestTransportOnce(transport, parameters) {
    const request = async () => {
        if (transport.kind === 'custom') {
            try {
                return (await transport.provider.request({
                    method: parameters.method,
                    params: parameters.params,
                }));
            }
            catch (error) {
                throw toRpcError(error, `${parameters.method} failed`);
            }
        }
        const response = await (transport.fetchFn ?? fetch)(transport.url, {
            body: JSON.stringify({
                id: 1,
                jsonrpc: '2.0',
                method: parameters.method,
                params: parameters.params ?? [],
            }),
            headers: {
                'content-type': 'application/json',
            },
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(transport.requestTimeout),
        });
        if (!response.ok) {
            throw new RpcError(`HTTP ${response.status} while calling ${parameters.method}`, {
                code: response.status,
                shortMessage: `HTTP ${response.status} while calling ${parameters.method}`,
            });
        }
        const payload = transport.responseParser === undefined ? (await response.json()) : await transport.responseParser(response, parameters.method);
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
            throw new RpcError(`Malformed JSON-RPC response while calling ${parameters.method}`);
        const envelope = payload;
        const hasResult = Object.prototype.hasOwnProperty.call(envelope, 'result');
        const hasError = Object.prototype.hasOwnProperty.call(envelope, 'error');
        if (envelope['jsonrpc'] !== '2.0' || envelope['id'] !== 1 || hasResult === hasError)
            throw new RpcError(`Malformed JSON-RPC response while calling ${parameters.method}`);
        if (hasError) {
            const error = envelope['error'];
            if (typeof error !== 'object' || error === null || Array.isArray(error))
                throw new RpcError(`Malformed JSON-RPC error while calling ${parameters.method}`);
            const errorRecord = error;
            const code = errorRecord['code'];
            const message = errorRecord['message'];
            if (typeof code !== 'number' || !Number.isInteger(code) || typeof message !== 'string')
                throw new RpcError(`Malformed JSON-RPC error while calling ${parameters.method}`);
            throw new RpcError(message, {
                cause: errorRecord['data'],
                code,
                shortMessage: message,
            });
        }
        return envelope['result'];
    };
    return transport.requestScheduler === undefined ? await request() : await transport.requestScheduler(parameters.method, request);
}
async function retryRateLimited(operation, options) {
    const startTime = options.timeout === undefined ? undefined : (options.startTime ?? Date.now());
    let retries = 0;
    while (true) {
        try {
            return await operation();
        }
        catch (error) {
            if (!isRateLimitError(error) || (options.retryCount !== undefined && retries >= options.retryCount))
                throw error;
            const remainingMilliseconds = options.timeout === undefined || startTime === undefined ? undefined : options.timeout - (Date.now() - startTime);
            if (remainingMilliseconds !== undefined && remainingMilliseconds <= 0)
                throw error;
            const delayMilliseconds = remainingMilliseconds === undefined ? options.retryDelay : Math.min(options.retryDelay, remainingMilliseconds);
            await new Promise(resolve => {
                setTimeout(resolve, delayMilliseconds);
            });
            if (options.timeout !== undefined && startTime !== undefined && Date.now() - startTime >= options.timeout)
                throw error;
            retries += 1;
        }
    }
}
async function runWithDeadline(parameters) {
    let deadlineTimer;
    const deadline = new Promise((_resolve, reject) => {
        deadlineTimer = setTimeout(() => reject(parameters.getTimeoutError()), parameters.timeout);
    });
    const runBeforeDeadline = async (operation) => await Promise.race([operation(), deadline]);
    try {
        return await parameters.operation(runBeforeDeadline);
    }
    finally {
        if (deadlineTimer !== undefined)
            clearTimeout(deadlineTimer);
    }
}
async function requestTransport(transport, parameters) {
    return await requestTransportOnce(transport, parameters);
}
async function requestTransportWithRateLimitRetries(transport, parameters) {
    return await retryRateLimited(async () => await requestTransportOnce(transport, parameters), {
        retryCount: transport.retryCount,
        retryDelay: transport.retryDelay,
    });
}
export async function requestRpc(transport, parameters) {
    return await requestTransport(transport, parameters);
}
function toRpcError(error, fallbackMessage) {
    if (error instanceof RpcError)
        return error;
    if (typeof error === 'object' && error !== null) {
        const code = 'code' in error && (typeof error.code === 'number' || typeof error.code === 'string') ? error.code : undefined;
        const message = 'message' in error && typeof error.message === 'string' ? error.message : fallbackMessage;
        return new RpcError(message, {
            cause: error,
            code,
            shortMessage: message,
        });
    }
    if (error instanceof Error) {
        return new RpcError(error.message, {
            cause: error,
            shortMessage: error.message,
        });
    }
    return new RpcError(fallbackMessage, {
        cause: error,
        shortMessage: fallbackMessage,
    });
}
function normalizeLog(value) {
    if (typeof value !== 'object' || value === null)
        throw new Error('RPC returned an invalid log');
    const log = value;
    const topics = log['topics'];
    if (!Array.isArray(topics))
        throw new Error('RPC returned a log without topics');
    return {
        address: normalizeAddress(log['address']),
        blockHash: log['blockHash'] === undefined || log['blockHash'] === null ? undefined : normalizeHash(log['blockHash']),
        blockNumber: log['blockNumber'] === undefined || log['blockNumber'] === null ? undefined : normalizeRpcBigInt(log['blockNumber']),
        data: normalizeRpcHex(log['data']),
        logIndex: log['logIndex'] === undefined || log['logIndex'] === null ? undefined : normalizeRpcBigInt(log['logIndex']),
        removed: normalizeOptionalLogRemoved(log['removed']),
        topics: topics.map(topic => normalizeHash(topic)),
        transactionHash: log['transactionHash'] === undefined || log['transactionHash'] === null ? undefined : normalizeHash(log['transactionHash']),
        transactionIndex: log['transactionIndex'] === undefined || log['transactionIndex'] === null ? undefined : normalizeRpcBigInt(log['transactionIndex']),
    };
}
function getLogAddressFilter(address) {
    if (address === undefined)
        return undefined;
    if (typeof address === 'string')
        return new Set([getAddress(address).toLowerCase()]);
    if (address.length === 0)
        return undefined;
    return new Set(address.map(item => getAddress(item).toLowerCase()));
}
function logMatchesTopicFilter(logTopics, topicFilter) {
    if (topicFilter.length > logTopics.length)
        return false;
    for (const [index, filter] of topicFilter.entries()) {
        if (filter === null)
            continue;
        const alternatives = typeof filter === 'string' ? [filter] : filter;
        if (alternatives.length === 0)
            continue;
        const logTopic = logTopics[index];
        if (logTopic === undefined || !alternatives.some(topic => topic.toLowerCase() === logTopic.toLowerCase()))
            return false;
    }
    return true;
}
function snapshotLogTopicFilter(topicFilter) {
    return topicFilter.map(filter => (typeof filter === 'string' || filter === null ? filter : [...filter]));
}
function normalizeReceipt(value) {
    if (typeof value !== 'object' || value === null)
        throw new Error('RPC returned an invalid transaction receipt');
    const receipt = value;
    if (!Array.isArray(receipt['logs']))
        throw new Error('RPC returned a transaction receipt without required logs');
    const blockHash = normalizeHash(receipt['blockHash']);
    const blockNumber = normalizeRequiredReceiptQuantity(receipt['blockNumber'], 'blockNumber');
    const transactionHash = normalizeHash(receipt['transactionHash']);
    const transactionIndex = normalizeRequiredReceiptQuantity(receipt['transactionIndex'], 'transactionIndex');
    const logs = receipt['logs'].map(item => normalizeLog(item));
    for (const log of logs) {
        if (log.blockHash !== blockHash)
            throw new Error('RPC returned a transaction receipt with a log whose blockHash does not match the receipt');
        if (log.blockNumber !== blockNumber)
            throw new Error('RPC returned a transaction receipt with a log whose blockNumber does not match the receipt');
        if (log.transactionHash !== transactionHash)
            throw new Error('RPC returned a transaction receipt with a log whose transactionHash does not match the receipt');
        if (log.transactionIndex !== transactionIndex)
            throw new Error('RPC returned a transaction receipt with a log whose transactionIndex does not match the receipt');
    }
    return {
        blockHash,
        blockNumber,
        contractAddress: normalizeNullableAddress(receipt['contractAddress']) ?? null,
        cumulativeGasUsed: normalizeRequiredReceiptQuantity(receipt['cumulativeGasUsed'], 'cumulativeGasUsed'),
        effectiveGasPrice: receipt['effectiveGasPrice'] === undefined ? undefined : normalizeRpcBigInt(receipt['effectiveGasPrice']),
        from: normalizeAddress(receipt['from']),
        gasUsed: normalizeRequiredReceiptQuantity(receipt['gasUsed'], 'gasUsed'),
        logs,
        logsBloom: receipt['logsBloom'] === undefined ? undefined : normalizeRpcHex(receipt['logsBloom']),
        status: normalizeReceiptStatus(receipt['status']),
        to: normalizeNullableAddress(receipt['to']) ?? null,
        transactionHash,
        transactionIndex,
        type: normalizeTransactionType(receipt['type']),
    };
}
function normalizeRequiredTransactionQuantity(transaction, field) {
    const value = transaction[field];
    if (value === undefined || value === null)
        throw new Error(`RPC returned a transaction without ${field}`);
    return normalizeRpcBigInt(value);
}
function normalizeTransactionInput(transaction) {
    const value = transaction['input'] ?? transaction['data'];
    if (value === undefined || value === null)
        throw new Error('RPC returned a transaction without input data');
    return normalizeRpcHex(value);
}
function normalizeTransactionRecipient(transaction) {
    if (transaction['to'] === undefined)
        throw new Error('RPC returned a transaction without to');
    return normalizeNullableAddress(transaction['to']) ?? null;
}
function normalizeTransaction(value) {
    if (typeof value !== 'object' || value === null)
        throw new Error('RPC returned an invalid transaction');
    const transaction = value;
    return {
        blockHash: transaction['blockHash'] === undefined || transaction['blockHash'] === null ? undefined : normalizeHash(transaction['blockHash']),
        blockNumber: transaction['blockNumber'] === undefined || transaction['blockNumber'] === null ? undefined : normalizeRpcBigInt(transaction['blockNumber']),
        from: normalizeAddress(transaction['from']),
        gas: normalizeRequiredTransactionQuantity(transaction, 'gas'),
        gasPrice: transaction['gasPrice'] === undefined || transaction['gasPrice'] === null ? undefined : normalizeRpcBigInt(transaction['gasPrice']),
        hash: normalizeHash(transaction['hash']),
        input: normalizeTransactionInput(transaction),
        maxFeePerGas: transaction['maxFeePerGas'] === undefined || transaction['maxFeePerGas'] === null ? undefined : normalizeRpcBigInt(transaction['maxFeePerGas']),
        maxPriorityFeePerGas: transaction['maxPriorityFeePerGas'] === undefined || transaction['maxPriorityFeePerGas'] === null ? undefined : normalizeRpcBigInt(transaction['maxPriorityFeePerGas']),
        nonce: normalizeRequiredTransactionQuantity(transaction, 'nonce'),
        to: normalizeTransactionRecipient(transaction),
        transactionIndex: transaction['transactionIndex'] === undefined || transaction['transactionIndex'] === null ? undefined : normalizeRpcBigInt(transaction['transactionIndex']),
        type: normalizeTransactionType(transaction['type']),
        value: normalizeRequiredTransactionQuantity(transaction, 'value'),
    };
}
function normalizeBlock(value, includeTransactions, pending) {
    if (typeof value !== 'object' || value === null)
        throw new Error('RPC returned an invalid block');
    const block = value;
    if (block['timestamp'] === undefined || block['timestamp'] === null)
        throw new Error('RPC returned a block without a timestamp');
    const hash = block['hash'] === undefined || block['hash'] === null ? undefined : normalizeHash(block['hash']);
    const number = block['number'] === undefined || block['number'] === null ? undefined : normalizeRpcBigInt(block['number']);
    if (pending) {
        if (hash !== undefined || number !== undefined)
            throw new Error('RPC returned a pending block with mined identifiers');
    }
    else {
        if (hash === undefined)
            throw new Error('RPC returned a mined block without a hash');
        if (number === undefined)
            throw new Error('RPC returned a mined block without a number');
    }
    const rawTransactions = block['transactions'];
    if (!Array.isArray(rawTransactions))
        throw new Error('RPC returned a block without transactions');
    const transactions = (() => {
        if (!includeTransactions)
            return rawTransactions.map(transaction => normalizeHash(transaction));
        const normalizedTransactions = rawTransactions.map(transaction => normalizeTransaction(transaction));
        for (const [index, transaction] of normalizedTransactions.entries()) {
            if (pending) {
                if (transaction.blockHash !== undefined || transaction.blockNumber !== undefined || transaction.transactionIndex !== undefined)
                    throw new Error('RPC returned a pending block with a transaction containing mined metadata');
                continue;
            }
            if (transaction.blockHash !== hash)
                throw new Error('RPC returned a block with a transaction whose blockHash does not match the block');
            if (transaction.blockNumber !== number)
                throw new Error('RPC returned a block with a transaction whose blockNumber does not match the block');
            if (transaction.transactionIndex !== BigInt(index))
                throw new Error('RPC returned a block with a transaction whose transactionIndex does not match the block');
        }
        return normalizedTransactions;
    })();
    return {
        baseFeePerGas: block['baseFeePerGas'] === undefined || block['baseFeePerGas'] === null ? undefined : normalizeRpcBigInt(block['baseFeePerGas']),
        hash,
        number,
        parentHash: block['parentHash'] === undefined || block['parentHash'] === null ? undefined : normalizeHash(block['parentHash']),
        timestamp: normalizeRpcBigInt(block['timestamp']),
        transactions,
    };
}
function isBlockTransaction(value) {
    return typeof value === 'object' && value !== null && 'hash' in value && 'from' in value && 'nonce' in value;
}
function isTransactionNotFoundError(error) {
    return error instanceof Error && error.message.includes('could not be found');
}
function isRateLimitError(error) {
    const seen = new Set();
    let current = error;
    while (typeof current === 'object' && current !== null && !seen.has(current)) {
        seen.add(current);
        if (current instanceof RpcError && (current.code === 429 || current.code === '429' || current.code === -32_005 || current.code === '-32005' || current.message.includes('HTTP 429')))
            return true;
        current = 'cause' in current ? current.cause : undefined;
    }
    return false;
}
function isAlreadyKnownTransactionError(error) {
    return error instanceof RpcError && error.message.toLowerCase().includes('already known');
}
function getReplacementReason(originalTransaction, replacementTransaction) {
    if (replacementTransaction.to?.toLowerCase() === originalTransaction.from.toLowerCase() && replacementTransaction.value === 0n && replacementTransaction.input === '0x')
        return 'cancelled';
    if (replacementTransaction.to?.toLowerCase() === originalTransaction.to?.toLowerCase() && replacementTransaction.value === originalTransaction.value && replacementTransaction.input === originalTransaction.input)
        return 'repriced';
    return 'replaced';
}
const REPLACEMENT_SCAN_BLOCK_DEPTH = 12n;
async function findReplacementTransaction(actions, originalTransaction, parameters, blockReader = actions) {
    for (let blockNumber = parameters.fromBlock; blockNumber <= parameters.toBlock; blockNumber += 1n) {
        const block = await blockReader.getBlock({
            blockNumber,
            includeTransactions: true,
        });
        const replacementTransaction = block.transactions.find((transaction) => isBlockTransaction(transaction) && transaction.hash !== originalTransaction.hash && transaction.nonce === originalTransaction.nonce && transaction.from.toLowerCase() === originalTransaction.from.toLowerCase());
        if (replacementTransaction !== undefined)
            return replacementTransaction;
    }
    return undefined;
}
async function findReplacementTransactionBackwards(actions, originalTransaction, parameters, blockReader = actions) {
    for (let blockNumber = parameters.fromBlock; blockNumber >= parameters.toBlock; blockNumber -= 1n) {
        const replacementTransaction = await findReplacementTransaction(actions, originalTransaction, { fromBlock: blockNumber, toBlock: blockNumber }, blockReader);
        if (replacementTransaction !== undefined)
            return replacementTransaction;
    }
    return undefined;
}
async function findMinedNonceBlock(actions, originalTransaction, toBlock) {
    if ((await actions.getTransactionCount({ address: originalTransaction.from, blockNumber: toBlock })) <= originalTransaction.nonce)
        return undefined;
    let lowerBlock = 0n;
    let upperBlock = toBlock;
    while (lowerBlock < upperBlock) {
        const candidateBlock = lowerBlock + (upperBlock - lowerBlock) / 2n;
        const transactionCount = await actions.getTransactionCount({
            address: originalTransaction.from,
            blockNumber: candidateBlock,
        });
        if (transactionCount > originalTransaction.nonce)
            upperBlock = candidateBlock;
        else
            lowerBlock = candidateBlock + 1n;
    }
    return lowerBlock;
}
function buildRpcTransactionRequest(parameters) {
    const from = normalizeAccountAddress(parameters.account);
    const value = parameters.value ?? parameters.amount;
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
    };
}
function normalizeAccountAddress(account) {
    if (account === undefined)
        return undefined;
    return typeof account === 'string' ? getAddress(account) : account.address;
}
async function readContractRaw(transport, parameters) {
    const selectedBlocks = [parameters.blockHash, parameters.blockNumber, parameters.blockTag].filter(value => value !== undefined);
    if (selectedBlocks.length > 1)
        throw new Error('Contract reads accept only one block selector');
    let blockSelector = parameters.blockTag ?? 'latest';
    if (parameters.blockNumber !== undefined)
        blockSelector = hexQuantity(parameters.blockNumber);
    if (parameters.blockHash !== undefined)
        blockSelector = { blockHash: parameters.blockHash, requireCanonical: true };
    const abiItem = getNamedFunctionAbi(parameters.abi, parameters.functionName, parameters.args);
    const method = getContractMethod(abiItem);
    const data = ensure0x(nobleBytesToHex(method.encodeInput(normalizeCodecArguments(abiItem.inputs, parameters.args))));
    let rpcResult;
    try {
        rpcResult = await requestTransportWithRateLimitRetries(transport, {
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
        });
    }
    catch (cause) {
        const seen = new Set();
        let current = cause;
        while (typeof current === 'object' && current !== null && !seen.has(current)) {
            seen.add(current);
            if (current instanceof RpcError && current.message.toLowerCase().includes('revert')) {
                throw new ContractFunctionError('ContractFunctionRevertedError', current.message, cause);
            }
            current = 'cause' in current ? current.cause : undefined;
        }
        throw cause;
    }
    const rawResult = normalizeRpcHex(rpcResult);
    if (rawResult === '0x' && (abiItem.outputs?.length ?? 0) > 0) {
        throw new ContractFunctionError('ContractFunctionZeroDataError', `The contract function "${parameters.functionName}" returned no data ("0x"). The contract does not have the function "${parameters.functionName}".`);
    }
    return {
        abiItem,
        data: rawResult,
    };
}
function buildPublicClientActions({ chain, transport }) {
    const getCode = async (parameters) => {
        const result = normalizeRpcHex(await requestTransportWithRateLimitRetries(transport, {
            method: 'eth_getCode',
            params: [parameters.address, parameters.blockNumber === undefined ? (parameters.blockTag ?? 'latest') : hexQuantity(parameters.blockNumber)],
        }));
        return result === '0x' ? undefined : result;
    };
    return {
        estimateContractGas: async (parameters) => normalizeRequiredRpcBigInt(await requestTransportWithRateLimitRetries(transport, {
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
        }), 'gas estimate'),
        estimateGas: async (parameters) => normalizeRequiredRpcBigInt(await requestTransportWithRateLimitRetries(transport, {
            method: 'eth_estimateGas',
            params: [buildRpcTransactionRequest(parameters)],
        }), 'gas estimate'),
        getBalance: async (parameters) => normalizeRequiredRpcBigInt(await requestTransportWithRateLimitRetries(transport, {
            method: 'eth_getBalance',
            params: [parameters.address, parameters.blockNumber === undefined ? (parameters.blockTag ?? 'latest') : hexQuantity(parameters.blockNumber)],
        }), 'balance'),
        getBlock: async (parameters) => {
            const includeTransactions = parameters?.includeTransactions === true;
            const blockTag = parameters?.blockNumber === undefined ? (parameters?.blockTag ?? 'latest') : normalizeBlockTag(parameters.blockNumber);
            const block = await requestTransportWithRateLimitRetries(transport, {
                method: 'eth_getBlockByNumber',
                params: [blockTag, includeTransactions],
            });
            const normalizedBlock = normalizeBlock(block, includeTransactions, blockTag === 'pending');
            if (parameters?.blockNumber !== undefined && normalizedBlock.number !== parameters.blockNumber) {
                throw new Error(`RPC returned block ${normalizedBlock.number?.toString() ?? 'without a number'}, which does not match requested block ${parameters.blockNumber.toString()}`);
            }
            return normalizedBlock;
        },
        getBlockNumber: async () => normalizeRequiredRpcBigInt(await requestTransportWithRateLimitRetries(transport, { method: 'eth_blockNumber' }), 'block number'),
        getChainId: async () => bigintToSafeNumber(normalizeRequiredRpcBigInt(await requestTransportWithRateLimitRetries(transport, { method: 'eth_chainId' }), 'chain ID'), 'Chain ID'),
        getCode,
        getBytecode: getCode,
        getGasPrice: async () => normalizeRequiredRpcBigInt(await requestTransportWithRateLimitRetries(transport, { method: 'eth_gasPrice' }), 'gas price'),
        getTransactionCount: async (parameters) => normalizeRequiredRpcBigInt(await requestTransportWithRateLimitRetries(transport, {
            method: 'eth_getTransactionCount',
            params: [getAddress(parameters.address), parameters.blockNumber === undefined ? (parameters.blockTag ?? 'latest') : hexQuantity(parameters.blockNumber)],
        }), 'transaction count'),
        getLogs: async (parameters) => {
            const event = parameters.event;
            if (event !== undefined && parameters.topics !== undefined)
                throw new Error('getLogs accepts either an event or raw topics, not both');
            const address = typeof parameters.address === 'string' || parameters.address === undefined ? parameters.address : [...parameters.address];
            const addressFilter = getLogAddressFilter(address);
            const fromBlock = parameters.fromBlock;
            const toBlock = parameters.toBlock;
            const topics = parameters.topics ??
                (event === undefined
                    ? undefined
                    : encodeEventTopics({
                        abi: [event],
                        ...(parameters.args === undefined ? {} : { args: parameters.args }),
                        eventName: event.name ?? 'event',
                    }));
            const requestedTopics = topics === undefined ? undefined : snapshotLogTopicFilter(topics);
            const requestTopics = requestedTopics === undefined ? undefined : snapshotLogTopicFilter(requestedTopics);
            const rawLogs = await requestTransportWithRateLimitRetries(transport, {
                method: 'eth_getLogs',
                params: [
                    {
                        ...(address === undefined ? {} : { address }),
                        ...(fromBlock === undefined ? {} : { fromBlock: hexQuantity(fromBlock) }),
                        ...(toBlock === undefined ? {} : { toBlock: hexQuantity(toBlock) }),
                        ...(requestTopics === undefined ? {} : { topics: requestTopics }),
                    },
                ],
            });
            return rawLogs.map(rawLog => {
                const normalizedLog = normalizeLog(rawLog);
                if (addressFilter !== undefined && !addressFilter.has(normalizedLog.address.toLowerCase()))
                    throw new Error('RPC returned a log outside the requested filter');
                if (fromBlock !== undefined && (normalizedLog.blockNumber === undefined || normalizedLog.blockNumber < fromBlock))
                    throw new Error('RPC returned a log outside the requested filter');
                if (toBlock !== undefined && (normalizedLog.blockNumber === undefined || normalizedLog.blockNumber > toBlock))
                    throw new Error('RPC returned a log outside the requested filter');
                if (requestedTopics !== undefined && !logMatchesTopicFilter(normalizedLog.topics, requestedTopics))
                    throw new Error('RPC returned a log outside the requested filter');
                if (event === undefined)
                    return normalizedLog;
                const decodedLog = decodeEventLog({
                    abi: [event],
                    data: normalizedLog.data,
                    topics: normalizedLog.topics,
                });
                return {
                    ...normalizedLog,
                    args: decodedLog.args,
                    eventName: decodedLog.eventName,
                };
            });
        },
        getTransaction: async (parameters) => {
            const requestedHash = normalizeHash(parameters.hash);
            const rawTransaction = await requestTransportWithRateLimitRetries(transport, {
                method: 'eth_getTransactionByHash',
                params: [requestedHash],
            });
            if (rawTransaction === null)
                throw new Error(`Transaction with hash "${requestedHash}" could not be found.`);
            const transaction = normalizeTransaction(rawTransaction);
            requireMatchingTransactionHash(requestedHash, transaction.hash, 'transaction');
            return transaction;
        },
        getTransactionReceipt: async (parameters) => {
            const requestedHash = normalizeHash(parameters.hash);
            const rawReceipt = await requestTransportWithRateLimitRetries(transport, {
                method: 'eth_getTransactionReceipt',
                params: [requestedHash],
            });
            if (rawReceipt === null)
                throw new Error(`Transaction receipt with hash "${requestedHash}" could not be found.`);
            const receipt = normalizeReceipt(rawReceipt);
            requireMatchingTransactionHash(requestedHash, receipt.transactionHash, 'transaction receipt');
            return receipt;
        },
        multicall: async (parameters) => {
            const calls = [];
            for (const contract of parameters.contracts) {
                calls.push({
                    allowFailure: parameters.allowFailure,
                    callData: encodeFunctionData({
                        abi: contract.abi,
                        ...(contract.args === undefined ? {} : { args: contract.args }),
                        functionName: contract.functionName,
                    }),
                    target: contract.address,
                });
            }
            const rawResult = (await readContractRaw(transport, {
                abi: MULTICALL3_ABI,
                address: parameters.multicallAddress,
                args: [calls],
                blockNumber: parameters.blockNumber,
                functionName: 'aggregate3',
            }));
            const decoded = decodeFunctionOutput(rawResult.abiItem, rawResult.data);
            if (!Array.isArray(decoded))
                throw new Error('Unexpected multicall response');
            if (decoded.length !== parameters.contracts.length)
                throw new Error(`Multicall returned ${decoded.length.toString()} results for ${parameters.contracts.length.toString()} calls`);
            if (parameters.allowFailure) {
                return decoded.map((entry, index) => {
                    if (typeof entry !== 'object' || entry === null || !('success' in entry) || !('returnData' in entry)) {
                        return {
                            error: new Error('Unexpected multicall response'),
                            status: 'failure',
                        };
                    }
                    if (entry.success !== true) {
                        return {
                            error: new Error('Multicall contract call failed'),
                            status: 'failure',
                        };
                    }
                    const contract = parameters.contracts[index];
                    if (contract === undefined)
                        throw new Error('Missing multicall contract response');
                    const abiItem = getNamedFunctionAbi(contract.abi, contract.functionName, contract.args);
                    return {
                        result: decodeFunctionOutput(abiItem, entry.returnData),
                        status: 'success',
                    };
                });
            }
            return decoded.map((entry, index) => {
                if (typeof entry !== 'object' || entry === null || !('success' in entry) || !('returnData' in entry) || entry.success !== true) {
                    throw new Error('Multicall contract call failed');
                }
                const contract = parameters.contracts[index];
                if (contract === undefined)
                    throw new Error('Missing multicall contract response');
                const abiItem = getNamedFunctionAbi(contract.abi, contract.functionName, contract.args);
                return decodeFunctionOutput(abiItem, entry.returnData);
            });
        },
        readContract: async (parameters) => {
            const { abiItem, data } = await readContractRaw(transport, parameters);
            return decodeFunctionOutput(abiItem, data);
        },
        simulateContract: async (parameters) => {
            const { abiItem, data } = await readContractRaw(transport, parameters);
            return {
                result: decodeFunctionOutput(abiItem, data),
            };
        },
        waitForTransactionReceipt: async (parameters) => {
            const timeoutMilliseconds = parameters.timeout ?? 180_000;
            const pollingInterval = parameters.pollingInterval ?? 1_000;
            const startTime = Date.now();
            const actions = buildPublicClientActions({ chain, transport: { ...transport, retryCount: 0 } });
            let lastRateLimitError;
            let lastRequestError;
            let lastReceiptNotFoundError;
            return await runWithDeadline({
                getTimeoutError: () => lastRateLimitError ?? lastReceiptNotFoundError ?? lastRequestError ?? new Error(`Timed out while waiting for transaction receipt "${parameters.hash}".`),
                operation: async (runBeforeDeadline) => {
                    const waitForNextPoll = async () => {
                        let pollingTimer;
                        try {
                            await runBeforeDeadline(async () => await new Promise(resolve => {
                                pollingTimer = setTimeout(resolve, pollingInterval);
                            }));
                        }
                        finally {
                            if (pollingTimer !== undefined)
                                clearTimeout(pollingTimer);
                        }
                    };
                    const retryReceiptRateLimited = async (operation) => {
                        lastRateLimitError = undefined;
                        lastRequestError = undefined;
                        return await runBeforeDeadline(async () => await retryRateLimited(async () => {
                            lastRateLimitError = undefined;
                            lastRequestError = undefined;
                            try {
                                const result = await operation();
                                lastRateLimitError = undefined;
                                return result;
                            }
                            catch (error) {
                                if (error instanceof Error) {
                                    lastRateLimitError = isRateLimitError(error) ? error : undefined;
                                    lastRequestError = error;
                                }
                                throw error;
                            }
                        }, {
                            retryDelay: transport.retryDelay,
                            startTime,
                            timeout: timeoutMilliseconds,
                        }));
                    };
                    let originalTransaction = parameters.transaction;
                    let lastScannedReplacementBlock;
                    if (parameters.onReplaced !== undefined && originalTransaction === undefined) {
                        try {
                            originalTransaction = await retryReceiptRateLimited(async () => await actions.getTransaction({
                                hash: parameters.hash,
                            }));
                        }
                        catch (error) {
                            if (!isTransactionNotFoundError(error))
                                throw error;
                        }
                    }
                    while (true) {
                        try {
                            return await retryReceiptRateLimited(async () => await actions.getTransactionReceipt({
                                hash: parameters.hash,
                            }));
                        }
                        catch (error) {
                            if (!isTransactionNotFoundError(error))
                                throw error;
                            lastReceiptNotFoundError = error;
                            if (parameters.onReplaced !== undefined && originalTransaction === undefined) {
                                try {
                                    originalTransaction = await retryReceiptRateLimited(async () => await actions.getTransaction({
                                        hash: parameters.hash,
                                    }));
                                }
                                catch (transactionError) {
                                    if (!isTransactionNotFoundError(transactionError))
                                        throw transactionError;
                                }
                            }
                            if (originalTransaction !== undefined) {
                                const transactionToReplace = originalTransaction;
                                const latestBlockNumber = await retryReceiptRateLimited(async () => await actions.getBlockNumber());
                                const initialReplacementScan = lastScannedReplacementBlock === undefined;
                                let firstScanBlock = lastScannedReplacementBlock === undefined ? 0n : lastScannedReplacementBlock + 1n;
                                if (lastScannedReplacementBlock === undefined && latestBlockNumber > REPLACEMENT_SCAN_BLOCK_DEPTH) {
                                    firstScanBlock = latestBlockNumber - REPLACEMENT_SCAN_BLOCK_DEPTH;
                                }
                                const replacementBlockReader = {
                                    getBlock: async (parameters) => await retryReceiptRateLimited(async () => await actions.getBlock(parameters)),
                                };
                                let replacementTransaction = firstScanBlock > latestBlockNumber ? undefined : await findReplacementTransaction(actions, transactionToReplace, { fromBlock: firstScanBlock, toBlock: latestBlockNumber }, replacementBlockReader);
                                if (replacementTransaction === undefined && initialReplacementScan && firstScanBlock > 0n) {
                                    const historicalScanEnd = firstScanBlock - 1n;
                                    try {
                                        const replacementBlock = await findMinedNonceBlock({
                                            getTransactionCount: async (parameters) => await retryReceiptRateLimited(async () => await actions.getTransactionCount(parameters)),
                                        }, transactionToReplace, historicalScanEnd);
                                        if (replacementBlock !== undefined) {
                                            replacementTransaction = await findReplacementTransaction(actions, transactionToReplace, { fromBlock: replacementBlock, toBlock: replacementBlock }, replacementBlockReader);
                                        }
                                    }
                                    catch (error) {
                                        if (Date.now() - startTime >= timeoutMilliseconds)
                                            throw error;
                                        replacementTransaction = await findReplacementTransactionBackwards(actions, transactionToReplace, { fromBlock: historicalScanEnd, toBlock: 0n }, replacementBlockReader);
                                    }
                                }
                                lastScannedReplacementBlock = latestBlockNumber;
                                if (replacementTransaction !== undefined) {
                                    const transactionReceipt = await retryReceiptRateLimited(async () => await actions.getTransactionReceipt({
                                        hash: replacementTransaction.hash,
                                    }));
                                    parameters.onReplaced?.({
                                        reason: getReplacementReason(transactionToReplace, replacementTransaction),
                                        replacedTransaction: transactionToReplace,
                                        transaction: replacementTransaction,
                                        transactionReceipt,
                                    });
                                    return transactionReceipt;
                                }
                            }
                            if (Date.now() - startTime >= timeoutMilliseconds)
                                throw error;
                            await waitForNextPoll();
                        }
                    }
                },
                timeout: timeoutMilliseconds,
            });
        },
    };
}
function getClientDefaultAccountAddress(client) {
    if (!('account' in client))
        return undefined;
    const account = client.account;
    if (typeof account === 'string')
        return getAddress(account);
    if (typeof account !== 'object' || account === null)
        return undefined;
    if (!('address' in account) || typeof account.address !== 'string')
        return undefined;
    return getAddress(account.address);
}
export function publicActions(client) {
    const actions = buildPublicClientActions({
        chain: client.chain,
        transport: client.transport,
    });
    const defaultAccount = getClientDefaultAccountAddress(client);
    if (defaultAccount === undefined)
        return actions;
    const estimateContractGas = async (parameters) => await actions.estimateContractGas({
        ...parameters,
        account: parameters.account ?? defaultAccount,
    });
    const simulateContract = async (parameters) => await actions.simulateContract({
        ...parameters,
        account: parameters.account ?? defaultAccount,
    });
    return {
        ...actions,
        estimateContractGas,
        simulateContract,
    };
}
export function createPublicClient({ chain, transport }) {
    const resolvedChain = chain;
    const actions = buildPublicClientActions({
        chain: resolvedChain,
        transport,
    });
    let client;
    client = {
        ...actions,
        chain: resolvedChain,
        extend: extension => Object.assign({}, client, extension(client)),
        transport,
    };
    return client;
}
function normalizeWalletAccount(account) {
    if (account === undefined)
        return undefined;
    if (typeof account === 'string') {
        return {
            address: getAddress(account),
            type: 'json-rpc',
        };
    }
    return account;
}
export function createWalletClient({ account, chain, transport }) {
    const normalizedAccount = normalizeWalletAccount(account);
    const publicClient = chain === undefined
        ? createPublicClient({
            transport,
        })
        : createPublicClient({
            chain,
            transport,
        });
    const baseClient = publicClient;
    let walletClient;
    walletClient = {
        ...baseClient,
        account: normalizedAccount,
        call: async (parameters) => {
            const account = parameters.account ?? normalizedAccount;
            const data = normalizeRpcHex(await requestTransportWithRateLimitRetries(transport, {
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
            }));
            return {
                data,
            };
        },
        estimateContractGas: async (parameters) => await baseClient.estimateContractGas({
            ...parameters,
            account: parameters.account ?? normalizedAccount,
        }),
        sendRawTransaction: async (parameters) => {
            const expectedHash = keccak256(parameters.serializedTransaction);
            try {
                const returnedHash = normalizeHash(await requestTransportWithRateLimitRetries(transport, {
                    method: 'eth_sendRawTransaction',
                    params: [parameters.serializedTransaction],
                }));
                if (returnedHash !== expectedHash)
                    throw new Error(`RPC returned transaction hash ${returnedHash}, which does not match submitted transaction ${expectedHash}`);
                return expectedHash;
            }
            catch (error) {
                if (!isAlreadyKnownTransactionError(error))
                    throw error;
                return expectedHash;
            }
        },
        simulateContract: async (parameters) => await baseClient.simulateContract({
            ...parameters,
            account: parameters.account ?? normalizedAccount,
        }),
        sendTransaction: async (parameters) => {
            const sender = parameters.account ?? normalizedAccount;
            if (typeof sender === 'object' && sender !== null && sender.type === 'local' && sender.signTransaction !== undefined) {
                const hasMaxFeePerGas = parameters.maxFeePerGas !== undefined;
                const hasMaxPriorityFeePerGas = parameters.maxPriorityFeePerGas !== undefined;
                if (hasMaxFeePerGas !== hasMaxPriorityFeePerGas)
                    throw new Error('Local EIP-1559 transactions require both maxFeePerGas and maxPriorityFeePerGas');
                const value = parameters.value ?? parameters.amount;
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
                ]);
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
                });
                return await walletClient.sendRawTransaction({
                    serializedTransaction,
                });
            }
            const normalizedSender = (() => {
                if (sender === undefined)
                    return undefined;
                if (typeof sender === 'string')
                    return getAddress(sender);
                return sender;
            })();
            return normalizeHash(await requestTransport(transport, {
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
            }));
        },
        extend: extension => Object.assign({}, walletClient, extension(walletClient)),
        writeContract: async (parameters) => await walletClient.sendTransaction({
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
    };
    return walletClient;
}
function normalizeTransportRetryOptions(options = {}) {
    const retryCount = options.retryCount ?? DEFAULT_RATE_LIMIT_RETRY_COUNT;
    const retryDelay = options.retryDelay ?? RATE_LIMIT_RETRY_DELAY_MILLISECONDS;
    if (!Number.isSafeInteger(retryCount) || retryCount < 0)
        throw new Error('RPC retry count must be a non-negative safe integer');
    if (!Number.isSafeInteger(retryDelay) || retryDelay < 0)
        throw new Error('RPC retry delay must be a non-negative safe integer');
    return { ...(options.requestScheduler === undefined ? {} : { requestScheduler: options.requestScheduler }), retryCount, retryDelay };
}
function normalizeHttpTransportOptions(options = {}) {
    const requestTimeout = options.requestTimeout ?? 30_000;
    if (!Number.isSafeInteger(requestTimeout) || requestTimeout < 1)
        throw new Error('RPC request timeout must be a positive safe integer');
    return {
        ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
        ...(options.responseParser === undefined ? {} : { responseParser: options.responseParser }),
        ...normalizeTransportRetryOptions(options),
        requestTimeout,
    };
}
export function http(url, options) {
    return {
        kind: 'http',
        ...normalizeHttpTransportOptions(options),
        url,
    };
}
export function custom(provider, options) {
    return {
        kind: 'custom',
        provider,
        ...normalizeTransportRetryOptions(options),
    };
}
export function getAddress(value) {
    if (value.startsWith('0X'))
        throw new Error(`Invalid address: ${value}`);
    const parsed = addr.parse(value);
    if (!addr.isValid(value))
        throw new Error(`Invalid address: ${value}`);
    return ensure0x(addr.addChecksum(parsed.hasPrefix ? value : parsed.data));
}
export function isAddress(value) {
    if (value.startsWith('0X'))
        return false;
    return addr.isValid(value);
}
export function isHex(value, options = {}) {
    if (options.strict === true && !value.startsWith('0x'))
        return false;
    if (!value.startsWith('0x'))
        return false;
    if (value === '0x')
        return true;
    const normalized = stripHexPrefix(value);
    return isHexCharacter(normalized);
}
export function bytesToHex(value) {
    return ensure0x(nobleBytesToHex(value));
}
export function hexToBytes(value) {
    return nobleHexToBytes(ensureEvenHex(stripHexPrefix(value)));
}
export function concatHex(values) {
    return ensure0x(values.map(value => stripHexPrefix(value)).join(''));
}
export function toHex(value, options = {}) {
    if (typeof value === 'string') {
        return ensure0x(nobleBytesToHex(utf8ToBytes(value)));
    }
    if (typeof value === 'bigint' || typeof value === 'number') {
        const bigintValue = normalizeQuantityValue(value);
        if (options.size === undefined)
            return hexQuantity(bigintValue);
        const bytes = bigintToBytes(bigintValue);
        if (bytes.length > options.size)
            throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`);
        return ensure0x(nobleBytesToHex(Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes])));
    }
    const bytes = value;
    if (options.size === undefined)
        return ensure0x(nobleBytesToHex(bytes));
    if (bytes.length > options.size)
        throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`);
    return ensure0x(nobleBytesToHex(Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes])));
}
export function stringToHex(value) {
    return toHex(value);
}
export function numberToBytes(value, options = {}) {
    const bytes = bigintToBytes(normalizeQuantityValue(value));
    if (options.size === undefined)
        return bytes;
    if (bytes.length > options.size)
        throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`);
    return Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes]);
}
export function keccak256(value) {
    if (typeof value === 'string' && value.startsWith('0x')) {
        return ensure0x(nobleBytesToHex(keccak_256(hexToBytes(value))));
    }
    const bytes = typeof value === 'string' ? utf8ToBytes(value) : value;
    return ensure0x(nobleBytesToHex(keccak_256(bytes)));
}
export function encodeAbiParameters(parameters, values) {
    return deployContract([
        {
            inputs: parameters.map(parameter => cloneAbiParameter(parameter, { stripName: false })),
            type: 'constructor',
        },
    ], '0x', normalizeCodecArguments(parameters, values));
}
export function encodeFunctionData(parameters) {
    const abiItem = getNamedFunctionAbi(parameters.abi, parameters.functionName, parameters.args);
    const method = getContractMethod(abiItem);
    return ensure0x(nobleBytesToHex(method.encodeInput(normalizeCodecArguments(abiItem.inputs, parameters.args))));
}
export function decodeFunctionData(parameters) {
    const strippedAbi = normalizeAbi(parameters.abi)
        .filter((entry) => entry.type === 'function')
        .map((entry) => ({
        ...normalizeFunctionAbiForCodec(entry),
        outputs: entry.outputs,
    }));
    const decoder = new Decoder();
    decoder.add(zeroAddress, strippedAbi);
    const decoded = decoder.decode(zeroAddress, nobleHexToBytes(stripHexPrefix(parameters.data)), {});
    if (decoded === undefined || Array.isArray(decoded))
        throw new Error('Function selector was not found in the ABI');
    const functionAbi = getNamedFunctionAbi(parameters.abi, decoded.signature ?? decoded.name, normalizeDecodeFunctionArgs(decoded.value));
    return {
        args: normalizeDecodedArguments(functionAbi.inputs ?? [], decoded.value),
        functionName: decoded.name,
    };
}
export function decodeFunctionResult(parameters) {
    return decodeFunctionOutput(getNamedFunctionAbi(parameters.abi, parameters.functionName), parameters.data);
}
function encodeDeploymentWithMicroEthSigner(abi, bytecode, constructorArguments) {
    const deploymentEncoder = deployContract;
    const encoded = deploymentEncoder(...[abi, bytecode, ...constructorArguments]);
    if (typeof encoded !== 'string' || !isHex(encoded, { strict: true })) {
        throw new Error('Contract deployment encoding returned an invalid hex value');
    }
    return normalizeRpcHex(encoded);
}
export function encodeDeployData(parameters) {
    const constructorAbi = ensureConstructorAbi(parameters.abi);
    const constructorParameters = constructorAbi.find(entry => entry.type === 'constructor')?.inputs ?? [];
    const constructorArguments = constructorParameters.length === 0 ? [] : [normalizeCodecArguments(constructorParameters, parameters.args)];
    return encodeDeploymentWithMicroEthSigner(constructorAbi, parameters.bytecode, constructorArguments);
}
export function decodeEventLog(parameters) {
    const selector = parameters.topics[0];
    const matchingEvents = normalizeAbi(parameters.abi).filter((entry) => entry.type === 'event' && entry.name !== undefined && (entry.anonymous === true || (selector !== undefined && getEventSignatureHash(entry) === stripHexPrefix(selector).toLowerCase())));
    if (matchingEvents.length === 0) {
        if (selector === undefined)
            throw createDecodeError('DecodeLogTopicsMismatch', 'Event topics were missing');
        throw createDecodeError('AbiEventSignatureNotFoundError', 'Event signature was not found in the ABI');
    }
    const decodedEvents = [];
    let firstDecodeError;
    for (const matchingEvent of matchingEvents) {
        try {
            const decodedArgs = getEventDecoder(matchingEvent).decode(parameters.topics, parameters.data);
            decodedEvents.push({
                args: normalizeDecodedTuple(matchingEvent.inputs ?? [], decodedArgs),
                eventName: matchingEvent.name,
            });
        }
        catch (error) {
            if (firstDecodeError !== undefined)
                continue;
            if (error instanceof Error && error.message.toLowerCase().includes('topic'))
                firstDecodeError = createDecodeError('DecodeLogTopicsMismatch', error.message);
            else if (error instanceof Error)
                firstDecodeError = createDecodeError('DecodeLogDataMismatch', error.message);
            else
                firstDecodeError = createDecodeError('DecodeLogDataMismatch', 'Failed to decode event log');
        }
    }
    if (decodedEvents.length === 1)
        return decodedEvents[0];
    if (decodedEvents.length > 1)
        throw createDecodeError('AbiEventSignatureAmbiguousError', 'Event log matches more than one ABI event');
    throw firstDecodeError ?? createDecodeError('DecodeLogDataMismatch', 'Failed to decode event log');
}
export function encodeEventTopics(parameters) {
    const eventAbi = getNamedEventAbi(parameters.abi, parameters.eventName);
    const decoder = getEventDecoder(eventAbi);
    const inputs = eventAbi.inputs ?? [];
    const normalizedArgs = normalizeEventTopicArgs(eventAbi, parameters.args);
    const encodeNormalizedTopics = (values) => {
        const withPlaceholders = Array.isArray(values)
            ? inputs.map((input, index) => (input.indexed === true && values[index] === null ? eventTopicWildcardPlaceholder(input) : values[index]))
            : Object.fromEntries(inputs.map(input => {
                const name = input.name;
                if (name === undefined)
                    throw new Error('ABI event input name is missing');
                const value = Reflect.get(values, name);
                return [name, input.indexed === true && value === null ? eventTopicWildcardPlaceholder(input) : value];
            }));
        const topics = decoder.topics(withPlaceholders);
        let topicIndex = eventAbi.anonymous === true ? 0 : 1;
        for (const [inputIndex, input] of inputs.entries()) {
            if (input.indexed !== true)
                continue;
            let value;
            if (Array.isArray(values))
                value = values[inputIndex];
            else if (input.name !== undefined)
                value = Reflect.get(values, input.name);
            if (value === null)
                topics[topicIndex] = null;
            topicIndex += 1;
        }
        return topics.map(topic => (topic === null ? null : ensure0x(topic)));
    };
    const usesFullInputArray = Array.isArray(parameters.args) && parameters.args.length === inputs.length;
    let indexedInputIndex = 0;
    const alternatives = inputs.flatMap((input, inputIndex) => {
        const indexedPosition = indexedInputIndex;
        if (input.indexed === true)
            indexedInputIndex += 1;
        if (input.indexed !== true || input.type.includes('[') || input.type.startsWith('tuple'))
            return [];
        const argumentIndex = usesFullInputArray ? inputIndex : indexedPosition;
        let value;
        if (Array.isArray(parameters.args))
            value = parameters.args[argumentIndex];
        else if (parameters.args !== undefined && input.name !== undefined)
            value = Reflect.get(parameters.args, input.name);
        return Array.isArray(value) ? [{ input, inputIndex, selectionIndex: Array.isArray(parameters.args) ? argumentIndex : inputIndex, values: value }] : [];
    });
    if (alternatives.length === 0)
        return encodeNormalizedTopics(normalizedArgs);
    const withAlternatives = (selected) => normalizeEventTopicArgs(eventAbi, Array.isArray(parameters.args)
        ? parameters.args.map((value, argumentIndex) => selected.get(argumentIndex) ?? value)
        : Object.fromEntries(inputs.map((input, inputIndex) => [input.name, selected.get(inputIndex) ?? (parameters.args === undefined ? undefined : Reflect.get(parameters.args, input.name))])));
    const defaults = new Map(alternatives.map(({ selectionIndex, values }) => [selectionIndex, values[0]]));
    const topics = encodeNormalizedTopics(withAlternatives(defaults));
    for (const { input, inputIndex, selectionIndex, values } of alternatives) {
        const topicIndex = inputs.slice(0, inputIndex + 1).filter(candidate => candidate.indexed === true).length;
        topics[topicIndex] = values.map(value => {
            const topic = encodeNormalizedTopics(withAlternatives(new Map([...defaults, [selectionIndex, value]])))[topicIndex];
            if (topic === undefined || topic === null)
                throw new Error(`Event topic ${topicIndex.toString()} could not be encoded for ${input.name ?? 'indexed input'}`);
            return ensure0x(topic);
        });
    }
    return topics;
}
export function parseTransaction(serializedTransaction) {
    const transaction = MicroTransaction.fromHex(serializedTransaction);
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
    };
}
export async function recoverTransactionAddress(parameters) {
    return getAddress(MicroTransaction.fromHex(parameters.serializedTransaction).sender);
}
export function privateKeyToAccount(privateKey) {
    return {
        address: getAddress(addr.fromPrivateKey(privateKey)),
        signMessage: async (message) => ensure0x(eip191Signer.sign(message, privateKey)),
        signTransaction: async (parameters) => {
            if (parameters.gasPrice !== undefined && (parameters.maxFeePerGas !== undefined || parameters.maxPriorityFeePerGas !== undefined)) {
                throw new Error('Transaction fee fields must use either gasPrice or EIP-1559 fee caps, not both.');
            }
            if (parameters.chainId === undefined || parameters.gas === undefined || parameters.nonce === undefined) {
                throw new Error('Local transaction signing requires chainId, gas, and nonce to be prepared');
            }
            if (parameters.gasPrice === undefined && (parameters.maxFeePerGas === undefined || parameters.maxPriorityFeePerGas === undefined)) {
                throw new Error('Local EIP-1559 transaction signing requires maxFeePerGas and maxPriorityFeePerGas to be prepared');
            }
            const type = parameters.gasPrice !== undefined ? 'legacy' : 'eip1559';
            const transaction = MicroTransaction.prepare({
                chainId: normalizeQuantityValue(parameters.chainId),
                data: parameters.data ?? '0x',
                gasLimit: normalizeQuantityValue(parameters.gas),
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
                nonce: normalizeQuantityValue(parameters.nonce),
                to: parameters.to ?? '0x',
                value: parameters.value ?? 0n,
            });
            return transaction.signBy(privateKey).toHex();
        },
        type: 'local',
    };
}
export function getCreateAddress(parameters) {
    const fromBytes = nobleHexToBytes(stripHexPrefix(parameters.from));
    const nonceBytes = parameters.nonce === 0n ? new Uint8Array([]) : bigintToBytes(parameters.nonce);
    const encoded = rlpEncodeList([rlpEncodeBytes(fromBytes), rlpEncodeBytes(nonceBytes)]);
    return checksumAddressFromBytes(keccak_256(encoded).slice(-20));
}
export function getCreate2Address(parameters) {
    const fromBytes = nobleHexToBytes(stripHexPrefix(parameters.from));
    const saltBytes = parameters.salt instanceof Uint8Array ? parameters.salt : hexToBytes(parameters.salt);
    if (saltBytes.length !== 32)
        throw new Error('CREATE2 salt must be 32 bytes');
    const bytecodeHashBytes = (() => {
        if (parameters.bytecodeHash !== undefined)
            return hexToBytes(parameters.bytecodeHash);
        if (parameters.bytecode === undefined)
            return undefined;
        return keccak_256(hexToBytes(parameters.bytecode));
    })();
    if (bytecodeHashBytes === undefined)
        throw new Error('CREATE2 address derivation requires bytecode or bytecodeHash');
    const encoded = concatBytes(Uint8Array.of(0xff), fromBytes, saltBytes, bytecodeHashBytes);
    return checksumAddressFromBytes(keccak_256(encoded).slice(-20));
}
export function parseUnits(value, decimals) {
    const trimmed = value.trim();
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed))
        throw new Error(`Invalid decimal value: ${value}`);
    const negative = trimmed.startsWith('-');
    const normalized = negative ? trimmed.slice(1) : trimmed;
    const [wholePartRaw, fractionPartRaw = ''] = normalized.split('.');
    const wholePart = wholePartRaw === '' ? '0' : wholePartRaw;
    const trimmedFraction = fractionPartRaw.replace(/0+$/, '');
    if (trimmedFraction.length > decimals)
        throw new Error(`Too many decimal places: expected at most ${decimals.toString()}`);
    const paddedFraction = trimmedFraction.padEnd(decimals, '0');
    const combined = `${wholePart}${paddedFraction}`.replace(/^0+/, '') || '0';
    const result = BigInt(combined);
    return negative ? -result : result;
}
export function formatUnits(value, decimals) {
    const negative = value < 0n;
    const normalized = negative ? -value : value;
    const base = 10n ** BigInt(decimals);
    const whole = normalized / base;
    const fraction = normalized % base;
    if (fraction === 0n)
        return `${negative ? '-' : ''}${whole.toString()}`;
    const fractionString = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${negative ? '-' : ''}${whole.toString()}.${fractionString}`;
}
export function formatEther(value) {
    return formatUnits(value, 18);
}
function findMatchingParenthesis(value, openingIndex) {
    let depth = 0;
    for (let index = openingIndex; index < value.length; ++index) {
        const character = value[index];
        if (character === '(') {
            depth += 1;
            continue;
        }
        if (character !== ')')
            continue;
        depth -= 1;
        if (depth === 0)
            return index;
    }
    throw new Error(`Unable to parse ABI item: ${value}`);
}
function splitTopLevelCommaSeparated(value) {
    const entries = [];
    let current = '';
    let depth = 0;
    for (const character of value) {
        if (character === '(') {
            depth += 1;
            current += character;
            continue;
        }
        if (character === ')') {
            depth -= 1;
            if (depth < 0)
                throw new Error(`Unable to parse ABI item: ${value}`);
            current += character;
            continue;
        }
        if (character === ',' && depth === 0) {
            const trimmedEntry = current.trim();
            if (trimmedEntry !== '')
                entries.push(trimmedEntry);
            current = '';
            continue;
        }
        current += character;
    }
    if (depth !== 0)
        throw new Error(`Unable to parse ABI item: ${value}`);
    const finalEntry = current.trim();
    if (finalEntry !== '')
        entries.push(finalEntry);
    return entries;
}
function canonicalizeHumanReadableAbiType(type) {
    const typeMatch = /^(?<baseType>[^\[]+)(?<arraySuffix>(?:\[[0-9]*\])*)$/u.exec(type);
    if (typeMatch === null)
        return type;
    const baseType = typeMatch.groups?.['baseType'];
    const arraySuffix = typeMatch.groups?.['arraySuffix'] ?? '';
    if (baseType === undefined)
        return type;
    const canonicalBaseType = (() => {
        if (baseType === 'uint')
            return 'uint256';
        if (baseType === 'int')
            return 'int256';
        if (baseType === 'byte')
            return 'bytes1';
        if (baseType === 'fixed')
            return 'fixed128x18';
        if (baseType === 'ufixed')
            return 'ufixed128x18';
        return baseType;
    })();
    return `${canonicalBaseType}${arraySuffix}`;
}
function parseAbiParameterEntry(entry) {
    const trimmedEntry = entry.trim();
    if (trimmedEntry === '')
        throw new Error(`Unable to parse ABI parameter: ${entry}`);
    const indexed = /(?:^|\s)indexed(?:\s|$)/u.test(trimmedEntry);
    const sanitizedEntry = trimmedEntry
        .replace(/\b(?:indexed|memory|calldata|storage)\b/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    if (/^(?:tuple\s*)?\(/u.test(sanitizedEntry)) {
        const openingIndex = sanitizedEntry.indexOf('(');
        const closingIndex = findMatchingParenthesis(sanitizedEntry, openingIndex);
        const componentsSource = sanitizedEntry.slice(openingIndex + 1, closingIndex);
        const trailingSource = sanitizedEntry.slice(closingIndex + 1).trim();
        const tupleMatch = /^(?<arraySuffix>(?:\[[0-9]*\])*)(?:\s*(?<name>[A-Za-z_][A-Za-z0-9_]*))?$/u.exec(trailingSource);
        if (tupleMatch === null)
            throw new Error(`Unable to parse ABI parameter: ${entry}`);
        const arraySuffix = tupleMatch.groups?.['arraySuffix'] ?? '';
        const name = tupleMatch.groups?.['name'];
        return {
            ...(indexed ? { indexed } : {}),
            ...(name === undefined ? {} : { name }),
            components: parseParameterList(componentsSource),
            type: `tuple${arraySuffix}`,
        };
    }
    const parameterMatch = /^(?<type>\S+)(?:\s+(?<name>[A-Za-z_][A-Za-z0-9_]*))?$/u.exec(sanitizedEntry);
    if (parameterMatch === null)
        throw new Error(`Unable to parse ABI parameter: ${entry}`);
    const type = parameterMatch.groups?.['type'];
    const name = parameterMatch.groups?.['name'];
    if (type === undefined)
        throw new Error(`Unable to parse ABI parameter: ${entry}`);
    return {
        ...(indexed ? { indexed } : {}),
        ...(name === undefined ? {} : { name }),
        type: canonicalizeHumanReadableAbiType(type),
    };
}
function parseParameterList(value) {
    if (value.trim() === '')
        return [];
    return splitTopLevelCommaSeparated(value).map(parseAbiParameterEntry);
}
export function parseAbiParameters(value) {
    return parseParameterList(value);
}
export function parseAbi(values) {
    return values.map(parseAbiItem);
}
export function parseAbiItem(value) {
    const trimmed = value.trim();
    const functionHeaderMatch = /^function\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(trimmed);
    if (functionHeaderMatch !== null) {
        const name = functionHeaderMatch.groups?.['name'];
        if (name === undefined)
            throw new Error(`Unsupported ABI item string: ${value}`);
        const inputsOpeningIndex = trimmed.indexOf('(', functionHeaderMatch[0].length - 1);
        const inputsClosingIndex = findMatchingParenthesis(trimmed, inputsOpeningIndex);
        const inputSource = trimmed.slice(inputsOpeningIndex + 1, inputsClosingIndex);
        const trailingSource = trimmed.slice(inputsClosingIndex + 1).trim();
        const returnsMatch = /\breturns\s*\(/u.exec(trailingSource);
        const modifiersSource = returnsMatch === null ? trailingSource : trailingSource.slice(0, returnsMatch.index).trim();
        const stateMutability = ['pure', 'view', 'payable', 'nonpayable'].find(candidate => new RegExp(`(?:^|\\s)${candidate}(?:\\s|$)`, 'u').test(modifiersSource));
        const unsupportedModifiers = modifiersSource
            .replace(/\b(?:external|public|internal|private|pure|view|payable|nonpayable)\b/gu, ' ')
            .replace(/\s+/gu, ' ')
            .trim();
        if (unsupportedModifiers !== '')
            throw new Error(`Unsupported ABI item string: ${value}`);
        const outputs = (() => {
            if (returnsMatch === null)
                return [];
            const returnsOpeningIndex = trailingSource.indexOf('(', returnsMatch.index);
            const returnsClosingIndex = findMatchingParenthesis(trailingSource, returnsOpeningIndex);
            const trailingAfterReturns = trailingSource.slice(returnsClosingIndex + 1).trim();
            if (trailingAfterReturns !== '')
                throw new Error(`Unsupported ABI item string: ${value}`);
            return parseParameterList(trailingSource.slice(returnsOpeningIndex + 1, returnsClosingIndex));
        })();
        return {
            inputs: parseParameterList(inputSource),
            name,
            outputs,
            ...(stateMutability === undefined ? {} : { stateMutability }),
            type: 'function',
        };
    }
    const eventHeaderMatch = /^event\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(trimmed);
    if (eventHeaderMatch !== null) {
        const name = eventHeaderMatch.groups?.['name'];
        if (name === undefined)
            throw new Error(`Unsupported ABI item string: ${value}`);
        const inputsOpeningIndex = trimmed.indexOf('(', eventHeaderMatch[0].length - 1);
        const inputsClosingIndex = findMatchingParenthesis(trimmed, inputsOpeningIndex);
        const inputSource = trimmed.slice(inputsOpeningIndex + 1, inputsClosingIndex);
        const trailingSource = trimmed.slice(inputsClosingIndex + 1).trim();
        if (trailingSource !== '' && trailingSource !== 'anonymous')
            throw new Error(`Unsupported ABI item string: ${value}`);
        return {
            ...(trailingSource === 'anonymous' ? { anonymous: true } : {}),
            inputs: parseParameterList(inputSource),
            name,
            type: 'event',
        };
    }
    throw new Error(`Unsupported ABI item string: ${value}`);
}

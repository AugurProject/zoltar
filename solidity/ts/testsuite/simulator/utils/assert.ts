type AssertionMessage = string | Error | undefined

type AssertionErrorOptions = {
	readonly message?: AssertionMessage
	readonly actual?: unknown
	readonly expected?: unknown
	readonly operator?: string
}

type Rejectable = Promise<unknown> | (() => unknown)

type RejectsMatcher = RegExp | { readonly message?: RegExp | string }

const formatValue = (value: unknown): string => {
	try {
		return Bun.inspect(value)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return `Unformattable value: ${message}`
	}
}

const resolveMessage = (message: AssertionMessage, fallback: string): string => {
	if (message === undefined) return fallback
	if (message instanceof Error) return message.message
	return message
}

const getErrorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message
	if (typeof error === 'object' && error !== null && 'message' in error) {
		const { message } = error
		if (typeof message === 'string') return message
	}
	return String(error)
}

class AssertionError extends Error {
	readonly actual: unknown
	readonly expected: unknown
	readonly operator: string | undefined

	constructor(options: AssertionErrorOptions = {}) {
		super(resolveMessage(options.message, `Expected ${formatValue(options.actual)} ${options.operator ?? 'to equal'} ${formatValue(options.expected)}`))
		this.name = 'AssertionError'
		this.actual = options.actual
		this.expected = options.expected
		this.operator = options.operator
	}
}

const fail = (options: AssertionErrorOptions): never => {
	throw new AssertionError(options)
}

const ok = (value: unknown, message?: AssertionMessage): void => {
	if (value) return
	fail({
		message: resolveMessage(message, `Expected ${formatValue(value)} to be truthy`),
		actual: value,
		expected: true,
		operator: 'ok',
	})
}

const strictEqual = <Type>(actual: Type, expected: Type, message?: AssertionMessage): void => {
	if (Object.is(actual, expected)) return
	fail({
		message: resolveMessage(message, `Expected ${formatValue(actual)} to strictly equal ${formatValue(expected)}`),
		actual,
		expected,
		operator: 'strictEqual',
	})
}

const notStrictEqual = <Type>(actual: Type, expected: Type, message?: AssertionMessage): void => {
	if (!Object.is(actual, expected)) return
	fail({
		message: resolveMessage(message, `Expected ${formatValue(actual)} not to strictly equal ${formatValue(expected)}`),
		actual,
		expected,
		operator: 'notStrictEqual',
	})
}

const deepStrictEqual = (actual: unknown, expected: unknown, message?: AssertionMessage): void => {
	if (Bun.deepEquals(actual, expected, true)) return
	fail({
		message: resolveMessage(message, `Expected ${formatValue(actual)} to deep strictly equal ${formatValue(expected)}`),
		actual,
		expected,
		operator: 'deepStrictEqual',
	})
}

const callRejectable = async (input: Rejectable): Promise<void> => {
	if (typeof input === 'function') {
		await input()
		return
	}
	await input
}

const matchesRejectsMatcher = (error: unknown, matcher: RejectsMatcher): boolean => {
	const message = getErrorMessage(error)
	if (matcher instanceof RegExp) return matcher.test(message)
	const expectedMessage = matcher.message
	if (expectedMessage === undefined) return true
	if (expectedMessage instanceof RegExp) return expectedMessage.test(message)
	return message === expectedMessage
}

const rejects = async (input: Rejectable, matcher?: RejectsMatcher, message?: AssertionMessage): Promise<void> => {
	let rejectedError: unknown
	let didReject = false
	try {
		await callRejectable(input)
	} catch (error) {
		didReject = true
		rejectedError = error
	}

	if (!didReject)
		fail({
			message: resolveMessage(message, 'Expected promise to reject'),
			actual: 'resolved',
			expected: 'rejection',
			operator: 'rejects',
		})
	if (matcher === undefined || matchesRejectsMatcher(rejectedError, matcher)) return
	fail({
		message: resolveMessage(message, `Rejected error message ${formatValue(getErrorMessage(rejectedError))} did not match ${formatValue(matcher)}`),
		actual: rejectedError,
		expected: matcher,
		operator: 'rejects',
	})
}

const assert = {
	AssertionError,
	deepStrictEqual,
	equal: strictEqual,
	notEqual: notStrictEqual,
	notStrictEqual,
	ok,
	rejects,
	strictEqual,
}

export default assert

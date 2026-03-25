declare module 'bun:test' {
	type TestCallback = () => void | Promise<void>
	type EachCallback<TestCase> = (testCase: TestCase) => void | Promise<void>
	type TestFunction = {
		(label: string, fn: TestCallback): void
		each: <TestCase>(cases: readonly TestCase[]) => (label: string, fn: EachCallback<TestCase>) => void
	}

	export const describe: (label: string, fn: TestCallback) => void
	export const test: TestFunction
	export const beforeAll: (fn: () => void | Promise<void>) => void
	export const beforeEach: (fn: () => void | Promise<void>) => void
	export const afterAll: (fn: () => void | Promise<void>) => void
}

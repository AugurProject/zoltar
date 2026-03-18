declare module 'bun:test' {
	export interface Test {
		(name: string, fn: (...args: any[]) => any): void
		only: Test
		skip: Test
		todo: Test
		each<T extends readonly any[]>(
			cases: readonly [...T],
		): {
			(name: string, fn: (...args: T[number][]) => any): void
		}
	}
	export interface TestContext {
		/**
		 * Number of times the test has failed.
		 */
		readonly errorCount: number
		/**
		 * Number of times the test has passed.
		 */
		readonly passCount: number
		/**
		 * Number of times the test has been run.
		 */
		readonly runCount: number
		/**
		 * Number of pending tests.
		 */
		readonly todoCount: number
		/**
		 * Name of the current test.
		 */
		readonly testName: string
		/**
		 * Add a listener for when the test fails. The listener is called with the error.
		 */
		onFailed(listener: (error: Error) => void): void
		/**
		 * Add a listener for when the test passes. The listener is called with the duration in milliseconds.
		 */
		onPassed(listener: (duration: number) => void)
		/**
		 * Add a listener for when the test is run. The listener is called with the duration in milliseconds.
		 */
		onRun(listener: (duration: number) => void)
		/**
		 * Add a listener for when the test starts.
		 */
		onStart(listener: () => void)
		/**
		 * Add a listener for when the test completes.
		 */
		onComplete(listener: () => void)
		/**
		 * Add a listener for when the test is skipped.
		 */
		onSkipped(listener: () => void)
		/**
		 * Add a listener for when the test is todo.
		 */
		onTodo(listener: () => void)
	}
	export const test: Test
	export const describe: (name: string, fn: () => void) => void
	export const beforeEach: (fn: () => any | Promise<any>) => void
	export const afterEach: (fn: () => any | Promise<any>) => void
	export const beforeAll: (fn: () => any | Promise<any>) => void
	export const afterAll: (fn: () => any | Promise<any>) => void
	export const expect: {
		<T>(value: T): {
			toBe(expected: T): void
			not: { toBe(expected: T): void }
			toEqual(expected: any): void
			not: { toEqual(expected: any): void }
			toBeDefined(): void
			toBeUndefined(): void
			toBeNull(): void
			toBeTruthy(): void
			toBeFalsy(): void
			toBeGreaterThan(expected: number): void
			toBeLessThan(expected: number): void
			toContain(item: any): void
			toHaveLength(expected: number): void
			toThrow(): void
			toThrowMessage(message: string): void
			toResolve(): Promise<void>
			toReject(): Promise<void>
		}
	}
}

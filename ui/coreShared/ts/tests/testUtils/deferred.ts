export type Deferred<Value> = {
	promise: Promise<Value>
	reject: (reason?: unknown) => void
	resolve: (value: Value | PromiseLike<Value>) => void
}

export function createDeferred<Value>(): Deferred<Value> {
	let resolve: Deferred<Value>['resolve'] = () => undefined
	let reject: Deferred<Value>['reject'] = () => undefined
	const promise = new Promise<Value>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

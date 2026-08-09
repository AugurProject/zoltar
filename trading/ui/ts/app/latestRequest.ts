export type RequestIdentity = Readonly<{ request: symbol }>

export function createLatestRequestGuard() {
	let current = Symbol('initial request')
	return {
		begin(): RequestIdentity {
			current = Symbol('active request')
			return { request: current }
		},
		invalidate() {
			current = Symbol('invalidated request')
		},
		isCurrent(identity: RequestIdentity) {
			return identity.request === current
		},
	}
}

import { afterEach, beforeEach } from 'bun:test'
import { resetActiveEnvironmentForTesting } from './ui/coreShared/ts/lib/activeEnvironment.js'

beforeEach(() => {
	resetActiveEnvironmentForTesting()
})
afterEach(() => {
	resetActiveEnvironmentForTesting()
})

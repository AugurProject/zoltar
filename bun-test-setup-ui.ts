import { afterEach, beforeEach } from 'bun:test'
import { resetActiveEnvironmentForTesting } from './ui/ts/lib/activeEnvironment.js'

beforeEach(() => {
	resetActiveEnvironmentForTesting()
})
afterEach(() => {
	resetActiveEnvironmentForTesting()
})

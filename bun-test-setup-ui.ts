import { afterEach, beforeEach, mock } from 'bun:test'
import { resetActiveEnvironmentForTesting } from './ui/coreShared/ts/lib/activeEnvironment.js'

beforeEach(() => {
	mock.restore()
	resetActiveEnvironmentForTesting()
})
afterEach(() => {
	mock.restore()
	resetActiveEnvironmentForTesting()
})

import { afterEach, beforeEach, mock } from 'bun:test'

beforeEach(() => {
	mock.restore()
})
afterEach(() => {
	mock.restore()
})

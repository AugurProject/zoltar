import { afterEach, beforeEach, mock, setDefaultTimeout } from 'bun:test'

setDefaultTimeout(300000)

beforeEach(() => {
	mock.restore()
})
afterEach(() => {
	mock.restore()
})

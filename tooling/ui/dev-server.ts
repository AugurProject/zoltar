import * as http from 'node:http'
import { getUiAppPaths, parseUiAppIdFromProcess } from './appPaths.mts'
import { createDevServerRequestHandler } from './devServerRequests.mts'
import { resolveDevServerPort } from './devServerPort.mts'

const appId = parseUiAppIdFromProcess('the development server')
const { appRoot: uiRootDirectory, repositoryRoot: repositoryRootDirectory } = getUiAppPaths(appId)

const server = http.createServer()
server.on('request', createDevServerRequestHandler({ repositoryRootDirectory, uiRootDirectory }))

// Initiate the server on `port` and print a message
const port = resolveDevServerPort(appId)
// Repository files and live reload are intended only for local development.
server.listen(port, '127.0.0.1')
server.on('listening', () => {
	const address = server.address()
	if (address === null) throw new Error('Server address unavailable after listen')
	const resolvedPort = typeof address === 'string' ? port : address.port
	process.send?.({ type: 'dev-server-ready', port: resolvedPort })
	console.log(`Web Server listening at http://localhost:${resolvedPort} ...`)
})

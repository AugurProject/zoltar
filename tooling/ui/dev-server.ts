import * as http from 'node:http'
import { getUiAppPaths, parseUiAppIdFromProcess, type UiAppId } from './appPaths.mts'
import { createDevServerRequestHandler } from './devServerRequests.mts'

const appId = parseUiAppIdFromProcess('the development server')
const { appRoot: uiRootDirectory, repositoryRoot: repositoryRootDirectory } = getUiAppPaths(appId)

const server = http.createServer()
server.on('request', createDevServerRequestHandler({ repositoryRootDirectory, uiRootDirectory }))

// Initiate the server on `port` and print a message
const ports: Record<UiAppId, number> = { statoblast: 12347, trading: 4163, zoltar: 4153 }
const port = ports[appId]
// Repository files and live reload are intended only for local development.
server.listen(port, '127.0.0.1')
server.on('listening', () => {
	const address = server.address()
	if (address === null) throw new Error('Server address unavailable after listen')
	const resolvedPort = typeof address === 'string' ? port : address.port
	console.log(`Web Server listening at http://localhost:${resolvedPort} ...`)
})

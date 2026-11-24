import type * as http from 'node:http'
import * as filesystem from 'node:fs/promises'
import * as path from 'node:path'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { getDevServerMimeType } from './devServerMimeTypes.mts'

type DevServerRoots = {
	readonly repositoryRootDirectory: string
	readonly uiRootDirectory: string
	readonly coreDeploymentRegistry?: (() => Promise<unknown>) | undefined
}

const isErrorWithCode = (error: unknown, codes: readonly string[]) => error instanceof Error && 'code' in error && typeof error.code === 'string' && codes.includes(error.code)

const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i
const appAssetPath = /^(?:index\.html$|favicon\.svg$|(?:css|js|vendor)\/)/
const sharedAssetPath = /^(?:ui\/(?:coreShared|zoltarShared|statoblastShared)\/(?:css|js|vendor)\/|shared\/(?:core|zoltar|statoblast|openOracle|trading)\/js\/)/

export const getServedFilePaths = (requestPath: string, { repositoryRootDirectory, uiRootDirectory }: DevServerRoots) => {
	const urlPath = requestPath.endsWith('/') ? `${requestPath}index.html` : requestPath
	const relativeFilePath = decodeURIComponent(urlPath).replace(/^\/+/, '')
	if (relativeFilePath.includes('\\') || relativeFilePath.split('/').some(segment => segment === '' || segment.startsWith('.'))) return []
	if (appAssetPath.test(relativeFilePath)) return [path.join(uiRootDirectory, relativeFilePath)]
	const appPrefix = `${path.relative(repositoryRootDirectory, uiRootDirectory).split(path.sep).join('/')}/`
	if (relativeFilePath.startsWith(appPrefix) && appAssetPath.test(relativeFilePath.slice(appPrefix.length))) return [path.join(repositoryRootDirectory, relativeFilePath)]
	if (sharedAssetPath.test(relativeFilePath)) return [path.join(repositoryRootDirectory, relativeFilePath)]
	return []
}

const createLiveReloadChannel = () => {
	const clients = new Set<http.ServerResponse>()
	const broadcast = (reason: string) => {
		for (const client of clients) {
			try {
				client.write(`event: reload\ndata: ${JSON.stringify({ reason })}\n\n`)
			} catch (error) {
				if (!isErrorWithCode(error, ['ECONNRESET', 'EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_INVALID_STATE'])) throw error
				clients.delete(client)
			}
		}
	}
	const handle = (request: http.IncomingMessage, response: http.ServerResponse, requestUrl: URL) => {
		if (request.method === 'GET') {
			response.writeHead(200, {
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'Content-Type': 'text/event-stream',
				'X-Accel-Buffering': 'no',
			})
			response.write('retry: 1000\n\n')
			clients.add(response)
			request.on('close', () => {
				clients.delete(response)
			})
			return
		}
		if (request.method === 'POST') {
			broadcast(requestUrl.searchParams.get('reason') ?? 'ui update')
			response.writeHead(204)
			response.end()
			return
		}
		response.writeHead(405)
		response.end()
	}
	return { handle }
}

export const createDevServerRequestHandler = (roots: DevServerRoots) => {
	const liveReload = createLiveReloadChannel()
	return async (request: http.IncomingMessage, response: http.ServerResponse) => {
		try {
			if (!loopbackHost.test(request.headers.host ?? '')) {
				response.writeHead(403)
				response.end()
				return
			}
			const requestUrl = new URL(request.url === undefined ? '/' : request.url, 'http://localhost')
			const requestPath = requestUrl.pathname
			if (requestPath === '/__live-reload') {
				liveReload.handle(request, response, requestUrl)
				return
			}
			if (requestPath === '/core-deployments.json' && roots.coreDeploymentRegistry !== undefined) {
				const deployments = await roots.coreDeploymentRegistry()
				response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
				response.end(JSON.stringify(deployments))
				return
			}
			const [filePath] = getServedFilePaths(requestPath, roots)
			if (filePath === undefined) {
				response.writeHead(403)
				response.end()
				return
			}

			const [realRepositoryRoot, realFilePath] = await Promise.all([filesystem.realpath(roots.repositoryRootDirectory), filesystem.realpath(filePath)])
			if (realFilePath !== path.join(realRepositoryRoot, path.relative(roots.repositoryRootDirectory, filePath))) {
				response.writeHead(403)
				response.end()
				return
			}
			const fileContents = await filesystem.readFile(realFilePath)
			const mimeType = getDevServerMimeType(filePath)
			if (mimeType !== undefined) {
				response.writeHead(200, { 'Content-Type': mimeType })
			}
			response.write(fileContents)
			response.end()
		} catch (error) {
			if (isErrorWithCode(error, ['ENOENT'])) {
				console.log(`404: ${request.url}`)
				response.writeHead(404)
				response.end()
			} else {
				console.log(`500: ${request.url}\n${errorMessage(error)}`)
				response.writeHead(500)
				response.end()
			}
		}
	}
}

import type * as http from 'node:http'
import * as filesystem from 'node:fs/promises'
import * as path from 'node:path'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { getDevServerMimeType } from './devServerMimeTypes.mts'

type DevServerRoots = {
	readonly repositoryRootDirectory: string
	readonly uiRootDirectory: string
}

const isErrorWithCode = (error: unknown, codes: readonly string[]) => error instanceof Error && 'code' in error && typeof error.code === 'string' && codes.includes(error.code)

// Resolves a request path to candidate files inside the app root, then the repository root; `shared/` paths only resolve from the repository root.
export const getServedFilePaths = (requestPath: string, { repositoryRootDirectory, uiRootDirectory }: DevServerRoots) => {
	const urlPath = requestPath.endsWith('/') ? `${requestPath}index.html` : requestPath
	const relativeFilePath = decodeURI(urlPath).replace(/^\/+/, '')
	const candidateRoots = relativeFilePath.startsWith('shared/') ? [repositoryRootDirectory] : [uiRootDirectory, repositoryRootDirectory]

	const candidateFilePaths: string[] = []
	for (const candidateRoot of candidateRoots) {
		const candidateFilePath = path.resolve(candidateRoot, relativeFilePath)
		if (candidateFilePath !== candidateRoot && !candidateFilePath.startsWith(`${candidateRoot}${path.sep}`)) {
			continue
		}
		candidateFilePaths.push(candidateFilePath)
	}

	return candidateFilePaths
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

const readFirstExistingFile = async (candidateFilePaths: readonly string[]) => {
	let lastError: unknown
	for (const candidateFilePath of candidateFilePaths) {
		try {
			return { fileContents: await filesystem.readFile(candidateFilePath), filePath: candidateFilePath }
		} catch (error) {
			if (!isErrorWithCode(error, ['ENOENT'])) throw error
			lastError = error
		}
	}
	throw lastError
}

export const createDevServerRequestHandler = (roots: DevServerRoots) => {
	const liveReload = createLiveReloadChannel()
	return async (request: http.IncomingMessage, response: http.ServerResponse) => {
		try {
			const requestUrl = new URL(request.url === undefined ? '/' : request.url, 'http://localhost')
			const requestPath = requestUrl.pathname
			if (requestPath === '/__live-reload') {
				liveReload.handle(request, response, requestUrl)
				return
			}
			const candidateFilePaths = getServedFilePaths(requestPath, roots)
			if (candidateFilePaths.length === 0) {
				response.writeHead(403)
				response.end()
				return
			}

			const { fileContents, filePath } = await readFirstExistingFile(candidateFilePaths)
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

import { simulationBootstrapFailed } from '../../ui/coreShared/ts/copy/app.ts'

type ProductionDocument = {
	readonly body: string
	readonly simulationStarting: boolean
	readonly timeOrigin: number
}

export function createProductionBrowserNavigation({
	bootstrapTimeoutMilliseconds,
	navigateDocument,
	now = Date.now,
	readDocument,
	wait = Bun.sleep,
}: {
	readonly bootstrapTimeoutMilliseconds: number
	readonly navigateDocument: (url: string) => Promise<{ readonly startsNewDocument: boolean }>
	readonly now?: () => number
	readonly readDocument: () => Promise<ProductionDocument>
	readonly wait?: (milliseconds: number) => Promise<unknown>
}) {
	const waitForDocumentReady = async (previousTimeOrigin?: number) => {
		let document: ProductionDocument | undefined
		const deadline = now() + bootstrapTimeoutMilliseconds
		while (now() < deadline) {
			document = await readDocument()
			const currentDocument = previousTimeOrigin === undefined || document.timeOrigin !== previousTimeOrigin
			if (currentDocument && document.body.includes(simulationBootstrapFailed)) throw new Error(`Production simulation failed to bootstrap: ${document.body}`)
			const remainingMilliseconds = deadline - now()
			if (remainingMilliseconds <= 0) break
			if (currentDocument && document.body !== '' && document.body !== 'Loading...' && document.body !== 'Loading…' && !document.simulationStarting) return
			await wait(Math.min(50, remainingMilliseconds))
		}
		throw new Error(`Production application did not finish loading: ${JSON.stringify(document)}`)
	}
	const navigate = async (url: string) => {
		const previousDocument = await readDocument()
		const { startsNewDocument } = await navigateDocument(url)
		// Page.navigate can return before the new document replaces the previous ready body.
		await waitForDocumentReady(startsNewDocument ? previousDocument.timeOrigin : undefined)
	}
	const waitForReady = async () => await waitForDocumentReady()
	return { navigate, waitForReady }
}

import path from 'node:path'
import * as prettier from 'prettier'
import { formatParagraphsOnSingleLines } from './format-html-prose.mts'

function docsAssetPrefix(outputPath: string): string {
	const depth = path.posix.relative('docs', outputPath).split('/').length - 1
	if (depth < 1) throw new Error(`Documentation pages must live below a docs section directory: ${outputPath}`)
	return '../'.repeat(depth)
}

export async function renderReferencePage(title: string, content: string, outputPath: string): Promise<string> {
	const assetPrefix = docsAssetPrefix(outputPath)
	const source = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${title}</title>
		<link rel="stylesheet" href="${assetPrefix}assets/css/shared-docs.css" />
		<link rel="stylesheet" href="${assetPrefix}assets/css/docsShell.css" />
	</head>
	<body class="doc-openoracle reference-page">
		<main><article>${content}</article></main>
		<script src="${assetPrefix}assets/js/responsiveDocs.js"></script>
		<script src="${assetPrefix}assets/js/docsData.js"></script>
		<script src="${assetPrefix}assets/js/docsShell.js"></script>
	</body>
</html>
`
	const options = (await prettier.resolveConfig(outputPath)) ?? {}
	return formatParagraphsOnSingleLines(await prettier.format(source, { ...options, filepath: outputPath, plugins: [] }))
}

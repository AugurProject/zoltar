import * as prettier from 'prettier'
import { formatParagraphsOnSingleLines } from './format-html-prose.mts'

export async function renderReferencePage(title: string, content: string, outputPath: string): Promise<string> {
	const source = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${title} · Statoblast docs</title>
		<link rel="stylesheet" href="../assets/css/shared-docs.css" />
		<link rel="stylesheet" href="../assets/css/docsShell.css" />
	</head>
	<body class="doc-openoracle reference-page">
		<main><article>${content}</article></main>
		<script src="../assets/js/responsiveDocs.js"></script>
		<script src="../assets/js/docsData.js"></script>
		<script src="../assets/js/docsShell.js"></script>
	</body>
</html>
`
	const options = (await prettier.resolveConfig(outputPath)) ?? {}
	return formatParagraphsOnSingleLines(await prettier.format(source, { ...options, filepath: outputPath, plugins: [] }))
}

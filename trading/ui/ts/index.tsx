import { render } from 'preact'
import { App } from './app/App.tsx'

const root = document.querySelector('#app')
if (!(root instanceof HTMLElement)) throw new Error('Application root is missing')
render(<App />, root)

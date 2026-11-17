// A development server with an explicit asset allowlist.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/schema.js', ['schema.js', 'text/javascript']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
])
const port = Number(process.env.PORT || 4173)
createServer(async (request, response) => {
  const file = files.get(request.url.split('?')[0])
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return
  }
  if (!file) {
    response.writeHead(404).end()
    return
  }
  try {
    const data = await readFile(new URL(`../public/${file[0]}`, import.meta.url))
    response.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` })
    response.end(request.method === 'GET' ? data : undefined)
  } catch {
    response.writeHead(500).end()
  }
}).listen(port, '127.0.0.1', () => console.log(`SchemaCraft running at http://localhost:${port}`))

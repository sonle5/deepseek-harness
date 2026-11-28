// Temporary evidence helper: a Messages endpoint that starts a reply and then holds the stream open,
// so the Session stays running while the sidebar is captured. Usage: node mock-messages.mjs <port> <logFile>
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const [port, logFile] = process.argv.slice(2)
const log = line => appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)
const send = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)

createServer((req, res) => {
  log(`${req.method} ${req.url}`)
  if (req.method === 'POST' && req.url?.endsWith('/messages')) {
    req.resume()
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    send(res, 'message_start', { message: { id: 'msg_evidence', type: 'message', role: 'assistant', model: 'deepseek-v4-flash', content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 0 } } })
    send(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    send(res, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Looking into the flaky test…' } })
    const ping = setInterval(() => res.write(': ping\n\n'), 5000)
    req.on('close', () => clearInterval(ping))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{"type":"error","error":{"type":"not_found_error","message":"not found"}}')
}).listen(Number(port), '127.0.0.1', () => log(`listening on ${port}`))

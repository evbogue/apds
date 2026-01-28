import db from './db.json' with { type: 'json'}
import { serveDir, serveFile } from 'https://deno.land/std/http/file_server.ts'
import { apds } from './apds.js'
import { createGossip } from './gossip.js'

await apds.start('apdsv1')

if (!await apds.pubkey()) {
  const keypair = await apds.generate()
  await apds.put('keypair', keypair)
  console.log('New keypair generated, your pubkey: ' + await apds.pubkey())
} else {
  console.log('apdsbot started, your pubkey: ' + await apds.pubkey())
}

const sockets = new Set()
const REQUEST_COOLDOWN_MS = 30000
const requestCooldown = new Map()

const isHash = (value) => typeof value === 'string' && value.length === 44
const canRequest = (hash) => {
  const now = Date.now()
  const last = requestCooldown.get(hash) || 0
  if (now - last < REQUEST_COOLDOWN_MS) { return false }
  requestCooldown.set(hash, now)
  return true
}

const requestHash = (ws, hash) => {
  if (!isHash(hash)) { return }
  if (!canRequest(hash)) { return }
  if (ws.readyState === 1) { ws.send(hash) }
}

const requestFromPeer = (send, hash) => {
  if (!isHash(hash)) { return }
  if (!canRequest(hash)) { return }
  send(hash)
}

const gossipQueue = createGossip({
  getPeers: () => sockets,
  has: async (hash) => !!(await apds.get(hash)),
  request: (peer, hash) => {
    if (peer.readyState === 1) peer.send(hash)
  },
  intervalMs: 10000,
})
gossipQueue.start()

const apdsbot = async (ws) => {
  sockets.add(ws)
  ws.onopen = async () => {
    setTimeout(async () => {
      const q = await apds.query()
      for (const m of q) {
        if (m.text) {
          const yaml = await apds.parseYaml(m.text)
          if (yaml.image) {
            const get = await apds.get(yaml.image)
            if (!get) {
              requestHash(ws, yaml.image)
            }
          }
          if (yaml.body) {
            const images = yaml.body.match(/!\[.*?\]\((.*?)\)/g)
            if (images) {
              for (const image of images) {
                const src = image.match(/!\[.*?\]\((.*?)\)/)[1]
                const imgBlob = await apds.get(src)
                if (!imgBlob) {
                  requestHash(ws, src)
                }
              }
            }
          }
          //console.log(yaml)
        }
      }
      //console.log(q)
    }, 1000)
    console.log('CONNECTED!')
  }
  ws.onmessage = async (m) => {
    console.log('RECEIVED:' + m.data)
    await handleIncomingMessage(m.data, (msg) => {
      if (ws.readyState === 1) { ws.send(msg) }
    })
  }
  ws.onclose = () => {
    sockets.delete(ws)
    console.log('DISCONNECTED!')
  }
}

const handleIncomingMessage = async (msg, send, logger = () => {}) => {
  if (isHash(msg)) {
    logger(`[gossip] recv hash ${msg}`)
    const latest = await apds.getLatest(msg)
    if (latest) { send(latest.sig) }
    const got = await apds.get(msg)
    if (got) {
      send(got)
      gossipQueue.resolve(msg)
    } else {
      requestFromPeer(send, msg)
      await gossipQueue.enqueue(msg)
    }
    return
  }
  const storedHash = await apds.make(msg)
  logger(`[gossip] recv blob ${storedHash} ${String(msg).slice(0, 80)}`)
  gossipQueue.resolve(storedHash)
  await apds.add(msg)
  const opened = await apds.open(msg)
  if (opened) {
    const content = await apds.get(opened.substring(13))
    if (!content) {
      console.log('no content')
      requestFromPeer(send, opened.substring(13))
    }
  }
  const yaml = await apds.parseYaml(msg)
  if (yaml.previous) {
    const prev = await apds.get(yaml.previous)
    if (!prev) {
      console.log('no previous')
      requestFromPeer(send, yaml.previous)
    }
  }
  if (yaml.image) {
    const img = await apds.get(yaml.image)
    if (!img) {
      requestFromPeer(send, yaml.image)
    }
  }
  if (yaml.body) {
    const images = yaml.body.match(/!\[.*?\]\((.*?)\)/g)
    if (images) {
      for (const image of images) {
        const src = image.match(/!\[.*?\]\((.*?)\)/)[1]
        const imgBlob = await apds.get(src)
        if (!imgBlob) {
          requestFromPeer(send, src)
        }
      }
    }
  }
}

const gossipHeaders = new Headers()
gossipHeaders.set('Content-Type', 'application/json')
gossipHeaders.set('Access-Control-Allow-Origin', '*')
gossipHeaders.set('Access-Control-Allow-Headers', 'content-type')
gossipHeaders.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: gossipHeaders
})

const handleHttpGossip = async (r) => {
  const url = new URL(r.url)
  if (!url.pathname.startsWith('/gossip')) { return null }
  if (r.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: gossipHeaders })
  }
  if (url.pathname === '/gossip' && r.method === 'POST') {
    const body = await r.text()
    const messages = []
    await handleIncomingMessage(
      body,
      (msg) => messages.push(msg),
      (line) => console.log(line)
    )
    if (messages.length) {
      const preview = messages[0]
      console.log(`[gossip] send ${messages.length} ${String(preview).slice(0, 80)}`)
    }
    return jsonResponse({ messages })
  }
  if (url.pathname === '/gossip/poll' && r.method === 'GET') {
    const since = parseInt(url.searchParams.get('since') || '0', 10)
    const limit = parseInt(url.searchParams.get('limit') || '200', 10)
    const q = await apds.query()
    const messages = []
    let nextSince = since
    if (q && q.length) {
      for (const msg of q) {
        const ts = parseInt(msg.ts || '0', 10)
        if (!ts || ts <= since) { continue }
        messages.push(msg.sig)
        if (msg.text) { messages.push(msg.text) }
        if (ts > nextSince) { nextSince = ts }
        if (messages.length >= limit) { break }
      }
    }
    if (messages.length) {
      const preview = messages[0]
      console.log(`[gossip] poll ${messages.length} ${String(preview).slice(0, 80)}`)
    }
    return jsonResponse({ messages, nextSince })
  }
  return jsonResponse({ error: 'not_found' }, 404)
}

const directory = async (r) => {
  const url = new URL(r.url)
  if (url.pathname === '/share' || url.pathname === '/share/') {
    return serveFile(r, `${Deno.cwd()}/share/index.html`)
  }
  if (url.pathname === '/events' || url.pathname === '/events/') {
    return serveFile(r, `${Deno.cwd()}/events/index.html`)
  }
  const key = url.pathname.substring(1)
  const header = new Headers()
  header.append("Content-Type", "application/json")
  header.append("Access-Control-Allow-Origin", "*")
  const q = await apds.query(key)
  if (db[key]) {
    const ar = db[key]
    return new Response(JSON.stringify(ar), {headers: header})
  }
  if (key === 'all') {
    const q = await apds.query()
    return new Response(JSON.stringify(q), {headers: header})
  }
  if (key === 'latest') {
    const q = await apds.query()
    const cutoff = Date.now() - (5 * 60 * 1000)
    const latest = q.filter(m => m.ts && parseInt(m.ts) > cutoff)
    return new Response(JSON.stringify(latest), {headers: header})
  }
  if (q && q[0]) {
    return new Response(JSON.stringify(q), {headers: header})
  } else if (await apds.get(key)) { 
    const blob = await apds.get(key)
    return new Response(blob, {headers: header})
  } else {
    return serveDir(r, {
      //quiet: true,
      enableCors: true
    })
  }
}

Deno.serve(
  {port: 9000},
  async (r) => {
  const httpGossip = await handleHttpGossip(r)
  if (httpGossip) { return httpGossip }
  try {
    const { socket, response } = Deno.upgradeWebSocket(r)
    await apdsbot(socket)
    return response
  } catch (err) {}
  try {
    return await directory(r) 
  } catch (err) {console.log(err)}
})

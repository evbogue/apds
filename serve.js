import db from './db.json' with { type: 'json'}
import { serveDir } from 'https://deno.land/std/http/file_server.ts'
import { apds } from './apds.js'
import { encode, decode } from './lib/base64.js'

await apds.start('apdsv1')

const encoder = new TextEncoder()

const subscriptionsPath = new URL('./subscriptions.json', import.meta.url)
const subscriptionsTmpPath = new URL('./subscriptions.json.tmp', import.meta.url)

const vapidPath = new URL('./vapid.json', import.meta.url)
const vapidTmpPath = new URL('./vapid.json.tmp', import.meta.url)

const toBase64Url = (b64) =>
  b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')

const fromBase64Url = (b64url) => {
  const b64 = b64url.replaceAll('-', '+').replaceAll('_', '/')
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  return b64 + pad
}

const base64UrlEncodeBytes = (bytes) => toBase64Url(encode(bytes))
const base64UrlDecodeBytes = (b64url) => decode(fromBase64Url(b64url))

const jsonHeaders = () => {
  const header = new Headers()
  header.append("Content-Type", "application/json")
  header.append("Access-Control-Allow-Origin", "*")
  return header
}

const corsPreflight = () => {
  const header = jsonHeaders()
  header.append('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  header.append('Access-Control-Allow-Headers', 'Content-Type')
  header.append('Access-Control-Max-Age', '86400')
  return new Response(null, { status: 204, headers: header })
}

const readSubscriptions = async () => {
  try {
    const txt = await Deno.readTextFile(subscriptionsPath)
    const parsed = JSON.parse(txt)
    if (!parsed || typeof parsed !== 'object') return { subscriptions: {} }
    if (!parsed.subscriptions || typeof parsed.subscriptions !== 'object') return { subscriptions: {} }
    return parsed
  } catch {
    return { subscriptions: {} }
  }
}

const writeSubscriptions = async (data) => {
  const payload = JSON.stringify(data, null, 2)
  await Deno.writeTextFile(subscriptionsTmpPath, payload)
  await Deno.rename(subscriptionsTmpPath, subscriptionsPath)
}

const readVapid = async () => {
  try {
    const txt = await Deno.readTextFile(vapidPath)
    const parsed = JSON.parse(txt)
    if (!parsed || typeof parsed !== 'object') return undefined
    if (typeof parsed.publicKey !== 'string') return undefined
    if (!parsed.privateJwk || typeof parsed.privateJwk !== 'object') return undefined
    if (typeof parsed.subject !== 'string') return undefined
    return parsed
  } catch {
    return undefined
  }
}

const writeVapid = async (data) => {
  const payload = JSON.stringify(data, null, 2)
  await Deno.writeTextFile(vapidTmpPath, payload)
  await Deno.rename(vapidTmpPath, vapidPath)
}

const ensureVapid = async () => {
  const existing = await readVapid()
  if (existing) return existing

  const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@localhost'
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keypair.publicKey))
  const publicKey = base64UrlEncodeBytes(publicRaw)
  const privateJwk = await crypto.subtle.exportKey('jwk', keypair.privateKey)

  const data = { subject, publicKey, privateJwk }
  await writeVapid(data)
  return data
}

if (!await apds.pubkey()) {
  const keypair = await apds.generate()
  await apds.put('keypair', keypair)
  console.log('New keypair generated, your pubkey: ' + await apds.pubkey())
} else {
  console.log('apdsbot started, your pubkey: ' + await apds.pubkey())
}

const vapid = await ensureVapid()
console.log('Web Push VAPID public key: ' + vapid.publicKey)

let pendingPush = false
let nextAllowedPushAt = 0
let flushTimer = undefined
const queuedPushSigs = new Set()

const broadcastPush = async (payloadObj) => {
  const store = await readSubscriptions()
  const endpoints = Object.keys(store.subscriptions ?? {})
  if (endpoints.length === 0) return

  const dead = new Set()
  const results = await Promise.allSettled(
    endpoints.map(async (endpoint) => {
      const entry = store.subscriptions[endpoint]
      if (!entry?.subscription) return
      try {
        const res = await sendWebPush(entry.subscription, payloadObj)
        if (res.status === 404 || res.status === 410) dead.add(endpoint)
      } catch {
        // Best-effort.
      }
    })
  )
  void results

  if (dead.size > 0) {
    for (const endpoint of dead) delete store.subscriptions[endpoint]
    store.updatedAt = Date.now()
    await writeSubscriptions(store)
  }
}

const scheduleFlush = (delayMs = 0) => {
  if (flushTimer !== undefined) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    void flushPushQueue()
  }, delayMs)
}

const flushPushQueue = async () => {
  if (pendingPush) return scheduleFlush(500)

  const now = Date.now()
  if (now < nextAllowedPushAt) return scheduleFlush(nextAllowedPushAt - now)

  const sigs = Array.from(queuedPushSigs).slice(0, 25)
  if (sigs.length === 0) return
  for (const sig of sigs) queuedPushSigs.delete(sig)

  pendingPush = true
  nextAllowedPushAt = now + 2000
  try {
    await broadcastPush({ type: 'anproto', sigs, ts: now })
  } finally {
    pendingPush = false
    if (queuedPushSigs.size > 0) scheduleFlush(0)
  }
}

const queuePushSig = (sig) => {
  if (typeof sig !== 'string' || sig.length === 0) return
  queuedPushSigs.add(sig)
  scheduleFlush(200)
}

const concatBytes = (...parts) => {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

const hmacSha256 = async (keyBytes, dataBytes) => {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, dataBytes)
  return new Uint8Array(sig)
}

const hkdfExtract = async (salt, ikm) => await hmacSha256(salt, ikm)

const hkdfExpand = async (prk, info, length) => {
  const hashLen = 32
  const n = Math.ceil(length / hashLen)
  let t = new Uint8Array(0)
  let okm = new Uint8Array(0)
  for (let i = 1; i <= n; i++) {
    const input = concatBytes(t, info, new Uint8Array([i]))
    t = await hmacSha256(prk, input)
    okm = concatBytes(okm, t)
  }
  return okm.slice(0, length)
}

const readDerLength = (bytes, offset) => {
  let length = bytes[offset]
  if ((length & 0x80) === 0) {
    return { length, read: 1 }
  }
  const numBytes = length & 0x7f
  length = 0
  for (let i = 0; i < numBytes; i++) {
    length = (length << 8) | bytes[offset + 1 + i]
  }
  return { length, read: 1 + numBytes }
}

const ecdsaDerToJose = (derSignature, size = 32) => {
  const bytes = derSignature instanceof Uint8Array ? derSignature : new Uint8Array(derSignature)
  let offset = 0
  if (bytes[offset++] !== 0x30) throw new Error('Invalid DER signature (no sequence)')
  const seqLen = readDerLength(bytes, offset)
  offset += seqLen.read
  if (bytes[offset++] !== 0x02) throw new Error('Invalid DER signature (no r)')
  const rLen = readDerLength(bytes, offset)
  offset += rLen.read
  let r = bytes.slice(offset, offset + rLen.length)
  offset += rLen.length
  if (bytes[offset++] !== 0x02) throw new Error('Invalid DER signature (no s)')
  const sLen = readDerLength(bytes, offset)
  offset += sLen.read
  let s = bytes.slice(offset, offset + sLen.length)

  while (r.length > 0 && r[0] === 0x00 && r.length > size) r = r.slice(1)
  while (s.length > 0 && s[0] === 0x00 && s.length > size) s = s.slice(1)
  if (r.length > size || s.length > size) throw new Error('Invalid DER signature (r/s too large)')

  const out = new Uint8Array(size * 2)
  out.set(r, size - r.length)
  out.set(s, size * 2 - s.length)
  return out
}

const createVapidJwt = async (endpoint) => {
  const url = new URL(endpoint)
  const aud = `${url.protocol}//${url.host}`
  const exp = Math.floor(Date.now() / 1000) + (12 * 60 * 60)
  const header = base64UrlEncodeBytes(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = base64UrlEncodeBytes(encoder.encode(JSON.stringify({ aud, exp, sub: vapid.subject })))
  const data = `${header}.${payload}`

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    vapid.privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  const derSig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoder.encode(data))
  )
  const joseSig = ecdsaDerToJose(derSig)
  const signature = base64UrlEncodeBytes(joseSig)
  return `${data}.${signature}`
}

const encryptWebPushPayload = async (subscription, payloadBytes) => {
  const receiverPublicKey = base64UrlDecodeBytes(subscription.keys.p256dh)
  const authSecret = base64UrlDecodeBytes(subscription.keys.auth)

  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )
  const senderPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))

  const receiverKey = await crypto.subtle.importKey(
    'raw',
    receiverPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, ephemeral.privateKey, 256)
  )

  const prk = await hkdfExtract(authSecret, sharedSecret)
  const authInfo = encoder.encode('Content-Encoding: auth\u0000')
  const ikm = await hkdfExpand(prk, authInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const prk2 = await hkdfExtract(salt, ikm)

  const context = concatBytes(
    new Uint8Array([0x00, 0x41]),
    receiverPublicKey,
    new Uint8Array([0x00, 0x41]),
    senderPublicKey
  )

  const cekInfo = concatBytes(encoder.encode('Content-Encoding: aes128gcm\u0000'), context)
  const nonceInfo = concatBytes(encoder.encode('Content-Encoding: nonce\u0000'), context)
  const cek = await hkdfExpand(prk2, cekInfo, 16)
  const nonce = await hkdfExpand(prk2, nonceInfo, 12)

  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const padding = new Uint8Array([0x00, 0x00])
  const plaintext = concatBytes(padding, payloadBytes)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext))

  return { salt, senderPublicKey, ciphertext }
}

const sendWebPush = async (subscription, payloadObj) => {
  const payloadBytes = encoder.encode(JSON.stringify(payloadObj))
  const { salt, senderPublicKey, ciphertext } = await encryptWebPushPayload(subscription, payloadBytes)
  const jwt = await createVapidJwt(subscription.endpoint)

  const header = new Headers()
  header.set('TTL', '300')
  header.set('Content-Type', 'application/octet-stream')
  header.set('Content-Encoding', 'aes128gcm')
  header.set('Encryption', `salt=${base64UrlEncodeBytes(salt)}`)
  header.set(
    'Crypto-Key',
    `dh=${base64UrlEncodeBytes(senderPublicKey)}; p256ecdsa=${vapid.publicKey}`
  )
  header.set('Authorization', `vapid t=${jwt}, k=${vapid.publicKey}`)

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: header,
    body: ciphertext
  })
  return res
}

const apdsbot = async (ws) => {
  ws.onopen = async () => {
    setTimeout(async () => {
      const q = await apds.query()
      for (const m of q) {
        if (m.text) {
          const yaml = await apds.parseYaml(m.text)
          if (yaml.image) {
            const get = await apds.get(yaml.image)
            if (!get) {
              ws.send(yaml.image)
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
    if (m.data.length === 44) {
      const latest = await apds.getLatest(m.data)
      if (latest) { ws.send(latest.sig) }
      const got = await apds.get(m.data)
      if (got) { ws.send(got) }
    }
    if (m.data.length != 44) {
      await apds.make(m.data)
      const added = await apds.add(m.data)
      const opened = await apds.open(m.data)
      if (opened) {
        const content = await apds.get(opened.substring(13))
        if (!content) {
          console.log('no content')
          ws.send(opened.substring(13))
        }
      }
      const yaml = await apds.parseYaml(m.data)
      if (yaml.previous) {
        const prev = await apds.get(yaml.previous)
        if (!prev) {
          console.log('no previous')
          ws.send(yaml.previous)
        }
      }
      if (added) {
        queuePushSig(m.data)
      }
    }
  }
  ws.onclose = () => {
    console.log('DISCONNECTED!')
  }
}

const directory = async (r) => {
  const url = new URL(r.url)
  if (r.method === 'OPTIONS') {
    return corsPreflight()
  }

  if (url.pathname === '/push/subscribe') {
    const header = jsonHeaders()
    if (r.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: header })
    }

    let body
    try {
      body = await r.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: header })
    }

    const subscription = body?.subscription ?? body
    const endpoint = subscription?.endpoint
    const p256dh = subscription?.keys?.p256dh
    const auth = subscription?.keys?.auth

    if (!endpoint || typeof endpoint !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing subscription.endpoint' }), { status: 400, headers: header })
    }
    if (!p256dh || !auth) {
      return new Response(JSON.stringify({ error: 'Missing subscription.keys' }), { status: 400, headers: header })
    }

    const store = await readSubscriptions()
    store.subscriptions ??= {}
    store.subscriptions[endpoint] = {
      subscription,
      updatedAt: Date.now()
    }
    store.updatedAt = Date.now()
    await writeSubscriptions(store)

    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: header })
  }

  if (url.pathname === '/push/vapidPublicKey') {
    const header = jsonHeaders()
    if (r.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: header })
    }
    return new Response(JSON.stringify({ publicKey: vapid.publicKey }), { status: 200, headers: header })
  }

  if (url.pathname === '/push/test') {
    const header = jsonHeaders()
    if (r.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: header })
    }
    await broadcastPush({ type: 'test', ts: Date.now() })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: header })
  }

  const key = url.pathname.substring(1)
  const header = jsonHeaders()
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
      //quiet: 'True',
      enableCors: 'True'
    })
  }
}

Deno.serve(
  {port: 9000},
  async (r) => {
  try {
    const { socket, response } = Deno.upgradeWebSocket(r)
    await apdsbot(socket)
    return response
  } catch (err) {}
  try {
    return await directory(r) 
  } catch (err) {console.log(err)}
})

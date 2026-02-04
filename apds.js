import { decode } from './lib/base64.js'
import { cachekv } from './lib/cachekv.js'
import { idbkv } from './lib/idbkv.js'
import { human } from './lib/human.js'
import { vb } from './lib/vb.js'
import { an } from 'https://esm.sh/gh/evbogue/anproto@ddc040c/an.js'

let db
let hashLog = []
let openedLog = []
let newMessages = false
let sort = true

export const apds = {}

const rebuildOpenedLog = async () => {
  const newArray = []

  await Promise.all(hashLog.map(async (hash) => {
    try {
      const obj = {
        hash,
        sig: await apds.get(hash)
      }
      if (!obj.sig) { return }
      const sigHash = await apds.hash(obj.sig)
      if (sigHash !== hash) {
        console.warn('hashlog integrity: sig hash mismatch', hash)
        await db.rm(hash)
        return
      }
      obj.author = obj.sig.substring(0, 44)
      obj.opened = await apds.open(obj.sig)
      if (!obj.opened || obj.opened.length < 14) {
        console.warn('hashlog integrity: open failed', hash)
        await db.rm(hash)
        return
      }
      const contentHash = obj.opened.substring(13)
      obj.text = await apds.get(contentHash)
      if (obj.text) {
        const contentSig = await apds.hash(obj.text)
        if (contentSig !== contentHash) {
          console.warn('hashlog integrity: content hash mismatch', hash)
          await db.rm(contentHash)
          return
        }
      }
      obj.ts = obj.opened.substring(0, 13)
      newArray.push(obj)
    } catch (err) { /* ignore per-entry */ }
  }))

  await newArray.sort((a, b) => a.ts - b.ts)

  const newLog = []
  await newArray.forEach(msg => {
    newLog.push(msg.hash)
  })

  hashLog = newLog
  openedLog = newArray
  newMessages = true
  sort = false
}

apds.ensureOpenLog = async () => {
  if (sort || !openedLog.length) {
    await rebuildOpenedLog()
  }
}

apds.start = async (appId) => {
  if ('indexedDB' in globalThis) {
    try {
      db = await idbkv(appId)
      const migrationFlag = 'cachekv_migrated_v1'
      const migrationDone = await db.get(migrationFlag)
      if (!migrationDone) {
        const legacy = await cachekv(appId)
        const migrated = []
        if (legacy && legacy.keys) {
          const keys = await legacy.keys()
          for (const key of keys) {
            if (key === migrationFlag) continue
            const value = await legacy.get(key)
            if (value === undefined) continue
            const existing = await db.get(key)
            if (existing === undefined) {
              await db.put(key, value)
            }
            await legacy.rm(key)
            migrated.push(key)
          }
        }
        await db.put(migrationFlag, new Date().toISOString())
        if (migrated.length) {
          console.log('apds: migrated cachekv to IndexedDB', migrated.join(', '))
        }
      }
    } catch (err) {
      console.warn('IndexedDB unavailable, falling back to Cache API', err)
    }
  }
  if (!db) {
    db = await cachekv(appId)
  }
  
  setInterval(async () => {
    if (newMessages) {
      await db.put('hashlog', JSON.stringify(hashLog))
      await db.put('openedlog', JSON.stringify(openedLog))
      newMessages = false
    } 
  }, 1000)
  
  const getHashLog = await db.get('hashlog')
  const getOpenedLog = await db.get('openedlog')
  if (getHashLog) {
    hashLog = JSON.parse(getHashLog)
  }
  if (getOpenedLog) {
    openedLog = JSON.parse(getOpenedLog)
  }
  
  setInterval(async () => {
    if (sort) {
      await rebuildOpenedLog()
    }
  }, 20000)
}

apds.generate = async () => {
  const genkey = await an.gen()
  return genkey
}

apds.keypair = async () => {
  const keypair = await db.get('keypair')
  if (keypair) {
    return keypair
  }
}

apds.pubkey = async () => {
  const keypair = await apds.keypair()
  if (keypair) {
    return keypair.substring(0, 44)
  }
}

apds.privkey = async () => {
  const keypair = await apds.keypair()
  if (keypair) {
    return keypair.substring(44)
  }
}

apds.deletekey = async () => {
  db.rm('keypair')
}

apds.clear = async () => {
  db.clear()
}

apds.hash = async (data) => { return await an.hash(data) }

apds.sign = async (data) => {
  const hash = await apds.make(data)
  const sig = await an.sign(hash, await apds.keypair())
  await apds.add(sig)
  const protocolMsg = await apds.make(sig)

  db.put('previous', protocolMsg)
  return protocolMsg
}

apds.open = async (msg) => {
  try {
    if (msg.endsWith('==')) {
      return await an.open(msg)
    } //else {
      //console.log('NOT A VALID SIGNATURE ' + msg)
    //}
  } catch (err) {
    //console.log('Not a valid ANProto message')
  }
}

import { yaml } from './lib/yaml.js'

apds.parseYaml = async (doc) => {
  return await yaml.parse(doc)
}

apds.createYaml = async (obj, content) => {
  return await yaml.create(obj, content)
}

const isHash = (value) => typeof value === 'string' && value.length === 44

const extractImagesFromBody = (body) => {
  if (!body) { return [] }
  const matches = body.match(/!\[.*?\]\((.*?)\)/g)
  if (!matches) { return [] }
  const hashes = []
  for (const image of matches) {
    const src = image.match(/!\[.*?\]\((.*?)\)/)?.[1]
    if (isHash(src)) { hashes.push(src) }
  }
  return hashes
}

apds.compose = async (content, prev) => {
  let obj = {}
  if (prev) { obj = prev }

  const name = await db.get('name')
  const image = await db.get('image')
  const previous = await db.get('previous')

  if (name) { obj.name = name}
  if (image) { obj.image = image}
  if (previous) { obj.previous = previous}

  if (Object.keys(obj).length > 0) { 
    const yaml = await apds.createYaml(obj, content)
    return await apds.sign(yaml)
  } else {
    return await apds.sign(content)
  } 
}

apds.make = async (data) => {
  const hash = await apds.hash(data)

  await db.put(hash, data)

  return hash
}

apds.get = async (hash) => {
  const blob = await db.get(hash)

  return blob
}

apds.put = async (key, value) => {
  await db.put(key, value)
}

apds.rm = async (key) => {
  await db.rm(key)
}

apds.add = async (msg) => {
  const opened = await apds.open(msg)
  if (opened) {
    const hash = await apds.make(msg)
    if (!hashLog.includes(hash)) {
      hashLog.push(hash)
      const obj = {
        hash,
        sig: msg
      }
      obj.author = obj.sig.substring(0, 44)
      obj.opened = opened
      obj.text = await apds.get(obj.opened.substring(13))
      obj.ts = obj.opened.substring(0, 13)
      openedLog.push(obj)
      newMessages = true
      sort = true
      return true
    }
  }
}

apds.purgeAuthor = async (author) => {
  if (!author || author.length !== 44) {
    return { removed: 0, blobs: 0 }
  }
  const targets = openedLog.filter(msg => msg.author === author)
  if (!targets.length) {
    return { removed: 0, blobs: 0 }
  }

  const hashesToRemove = new Set()
  const blobsToRemove = new Set()

  for (const msg of targets) {
    if (!msg || !msg.hash) { continue }
    hashesToRemove.add(msg.hash)
    const opened = msg.opened || (msg.sig ? await apds.open(msg.sig) : null)
    const contentHash = opened && opened.length > 13 ? opened.substring(13) : null
    const content = msg.text || (contentHash ? await apds.get(contentHash) : null)
    if (contentHash && isHash(contentHash)) {
      blobsToRemove.add(contentHash)
    }
    if (content) {
      const parsed = await apds.parseYaml(content)
      if (parsed?.image && isHash(parsed.image)) {
        blobsToRemove.add(parsed.image)
      }
      const bodyImages = extractImagesFromBody(parsed?.body)
      bodyImages.forEach(hash => blobsToRemove.add(hash))
    }
  }

  for (const hash of blobsToRemove) {
    await db.rm(hash)
  }
  for (const hash of hashesToRemove) {
    await db.rm(hash)
  }

  if (hashesToRemove.size) {
    hashLog = hashLog.filter(hash => !hashesToRemove.has(hash))
    openedLog = openedLog.filter(msg => msg.author !== author)
    newMessages = true
    sort = false
    await db.put('hashlog', JSON.stringify(hashLog))
    await db.put('openedlog', JSON.stringify(openedLog))
  }

  return { removed: hashesToRemove.size, blobs: blobsToRemove.size }
}

apds.getHashLog = async () => { return hashLog }

apds.getOpenedLog = async () => { return openedLog }

apds.query = async (query) => {
  if (!openedLog[0]) { return [] }
  if (!query) { return openedLog }
  if (query.startsWith('?')) {
    const search = query.substring(1).replace(/%20/g, ' ').toUpperCase()
    const result = openedLog.filter(msg => msg.text && msg.text.toUpperCase().includes(search))
    return result
  }
  const result = openedLog.filter(msg => msg.author == query || msg.hash == query)
  return result
}

apds.getPubkeys = async () => {
  const arr = await apds.query()
  const newSet = new Set()
  for (const msg of arr) {
    newSet.add(msg.author)
  }
  const newArr = [...newSet]
  return newArr
}

apds.getLatest = async (pubkey) => {
  const q = openedLog.filter(msg => msg.author === pubkey)
  return q[q.length -1]
}

apds.human = async (ts) => {
  return await human(new Date(parseInt(ts)))
}

apds.visual = async (pubkey) => {
  return vb(decode(pubkey), 256)
}

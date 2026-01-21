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

apds.start = async (appId) => {
  if ('indexedDB' in globalThis) {
    try {
      db = await idbkv(appId)
      const existingKeypair = await db.get('keypair')
      if (!existingKeypair) {
        const legacy = await cachekv(appId)
        if (legacy) {
          const legacyKeypair = await legacy.get('keypair')
          if (legacyKeypair) {
            await db.put('keypair', legacyKeypair)
            await legacy.rm('keypair')
          }
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
        } catch (err) { /*console.log(err)*/ }
      }))
      const newLog = []
 
      await newArray.sort((a,b) => a.ts - b.ts) 
  
      await newArray.forEach(msg => {
        newLog.push(msg.hash)
      })
  
      hashLog = newLog
      openedLog = newArray
      newMessages = true
      sort = false
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

apds.getHashLog = async () => { return hashLog }

apds.getOpenedLog = async () => { return openedLog }

apds.query = async (query) => {
  if (openedLog[0] && !query) { return openedLog }
  if (openedLog[0] && query.startsWith('?')) {
    const search = query.substring(1).replace(/%20/g, ' ').toUpperCase()
    const result = openedLog.filter(msg => msg.text && msg.text.toUpperCase().includes(search))
    return result
  } else if (openedLog[0]) {
    const result = openedLog.filter(msg => msg.author == query || msg.hash == query)
    return result
  }
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

import nacl from './lib/nacl-fast-es.js'
import { decode, encode } from './lib/base64.js'
import { cachekv } from './lib/cachekv.js'
import { human } from './lib/human.js'
import { vb } from './lib/vb.js'

let db
let hashLog = []
let openedLog = []
let newMessages = false
let sort = true

export const bogbot = {}

bogbot.start = async (appId) => {
  db = await cachekv(appId)
  
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
        const obj = {
          hash,
          sig: await bogbot.get(hash)
        }
        obj.author = obj.sig.substring(0, 44)
        obj.opened = await bogbot.open(obj.sig)
        obj.text = await bogbot.get(obj.opened.substring(13))
        obj.ts = obj.opened.substring(0, 13)
        newArray.push(obj)
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

bogbot.generate = async () => {
  const genkey = nacl.sign.keyPair()
  const keygen = encode(genkey.publicKey) + encode(genkey.secretKey)
  return keygen
}

bogbot.keypair = async () => {
  const keypair = await db.get('keypair')
  if (keypair) {
    return keypair
  }
}

bogbot.pubkey = async () => {
  const keypair = await bogbot.keypair()
  if (keypair) {
    return keypair.substring(0, 44)
  }
}

bogbot.privkey = async () => {
  const keypair = await bogbot.keypair()
  if (keypair) {
    return keypair.substring(44)
  }
}

bogbot.deletekey = async () => {
  db.rm('keypair')
}

bogbot.clear = async () => {
  db.clear()
}

bogbot.hash = async (data) => {
  return encode(
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))
      )
    )
  )
}

bogbot.sign = async (data) => {
  const timestamp = Date.now()

  const hash = await bogbot.make(data)

  const sig = encode(nacl.sign(new TextEncoder().encode(timestamp + hash), decode(await bogbot.privkey())))
  await bogbot.add(await bogbot.pubkey() + sig)
  const protocolMsg = await bogbot.make(await bogbot.pubkey() + sig)
  db.put('previous', protocolMsg)
  return protocolMsg
}

bogbot.open = async (msg) => {
  try {
    const pubkey = msg.substring(0, 44)
    const sig = msg.substring(44)

    const opened = new TextDecoder().decode(nacl.sign.open(decode(sig), decode(pubkey)))

    return opened
  } catch (err) {
    //console.log('Not a valid Bog5 protocol message')
  }
}

import { yaml } from './lib/yaml.js'

bogbot.parseYaml = async (doc) => {
  return await yaml.parse(doc)
}

bogbot.createYaml = async (obj, content) => {
  return await yaml.create(obj, content)
}

bogbot.compose = async (content, prev) => {
  let obj = {}
  if (prev) { obj = prev }

  const name = await db.get('name')
  const image = await db.get('image')
  const previous = await db.get('previous')

  if (name) { obj.name = name}
  if (image) { obj.image = image}
  if (previous) { obj.previous = previous}

  if (Object.keys(obj).length > 0) { 
    const yaml = await bogbot.createYaml(obj, content)
    return await bogbot.sign(yaml)
  } else {
    return await bogbot.sign(content)
  } 
}

bogbot.make = async (data) => {
  const hash = await bogbot.hash(data)

  await db.put(hash, data)

  return hash
}

bogbot.get = async (hash) => {
  const blob = await db.get(hash)

  return blob
}

bogbot.put = async (key, value) => {
  await db.put(key, value)
}

bogbot.rm = async (key) => {
  await db.rm(key)
}

bogbot.add = async (msg) => {
  const opened = await bogbot.open(msg)
  if (opened) {
    const hash = await bogbot.make(msg)
    if (!hashLog.includes(hash)) {
      hashLog.push(hash)
      const obj = {
        hash,
        sig: msg
      }
      obj.author = obj.sig.substring(0, 44)
      obj.opened = opened
      obj.text = await bogbot.get(obj.opened.substring(13))
      obj.ts = obj.opened.substring(0, 13)
      openedLog.push(obj)
      newMessages = true
      sort = true
    }
  }
}

bogbot.getHashLog = async () => { return hashLog }

bogbot.getOpenedLog = async () => { return openedLog }

bogbot.query = async (query) => {
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

bogbot.getPubkeys = async () => {
  const arr = await bogbot.query()
  const newSet = new Set()
  for (const msg of arr) {
    newSet.add(msg.author)
  }
  const newArr = [...newSet]
  return newArr
}

bogbot.getLatest = async (pubkey) => {
  const q = openedLog.filter(msg => msg.author === pubkey)
  return q[q.length -1]
}

bogbot.human = async (ts) => {
  return await human(new Date(parseInt(ts)))
}

bogbot.visual = async (pubkey) => {
  return vb(decode(pubkey), 256)
}


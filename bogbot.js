import nacl from './lib/nacl-fast-es.js'
import { decode, encode } from './lib/base64.js'
import { cachekv } from './lib/cachekv.js'

export const bogbot = {}

bogbot.generate = async () => {
  const genkey = nacl.sign.keyPair()
  const keygen = encode(genkey.publicKey) + encode(genkey.secretKey)
  return keygen
}

bogbot.keypair = async () => {
  const keypair = await localStorage.getItem('keypair')
  if (!keypair) {
    const keypair = await bogbot.generate()
    await localStorage.setItem('keypair', keypair)
    return keypair
  } else {
    return keypair
  }
}

bogbot.pubkey = async () => {
  const keypair = await bogbot.keypair()
  return keypair.substring(0, 44)
}

bogbot.privkey = async () => {
  const keypair = await bogbot.keypair()
  return keypair.substring(44)
}

bogbot.deletekey = async () => {
  localStorage.removeItem('keypair')
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

  const hash = await bogbot.hash(data)

  const sig = encode(nacl.sign(new TextEncoder().encode(timestamp + hash), decode(await bogbot.privkey())))

  return await bogbot.pubkey() + sig
}

bogbot.open = async (msg) => {
  const pubkey = msg.substring(0, 44)
  const sig = msg.substring(44)

  const opened = new TextDecoder().decode(nacl.sign.open(decode(sig), decode(pubkey)))

  return opened
}



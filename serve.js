import db from './db.json' with { type: 'json'}
import { serveDir } from 'https://deno.land/std/http/file_server.ts'
import { apds } from './apds.js'

await apds.start('apdsv1')

if (!await apds.pubkey()) {
  const keypair = await apds.generate()
  await apds.put('keypair', keypair)
  console.log('New keypair generated, your pubkey: ' + await apds.pubkey())
} else {
  console.log('apdsbot started, your pubkey: ' + await apds.pubkey())
}

const apdsbot = async (ws) => {
  ws.onopen = async () => {
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
      await apds.add(m.data)
    }
  }
  ws.onclose = () => {
    console.log('DISCONNECTED!')
  }
}

const directory = async (r) => {
  const url = new URL(r.url)
  const key = url.pathname.substring(1)
  const header = new Headers()
  header.append("Content-Type", "application/json")
  header.append("Access-Control-Allow-Origin", "*")
  if (db[key]) {
    const ar = db[key]
    return new Response(JSON.stringify(ar), {headers: header})
  }
  if (await apds.getLatest(key)) {
    const latest = await apds.getLatest(key)
    if (!latest.text) {
      const text = await apds.get(latest.opened.substring(13))
      latest.text = text.value
    }
    return new Response(JSON.stringify(latest), {headers: header})
  }
  else if (key != '' && await apds.query(key)) {
    const q = await apds.query(key)
    return new Response(JSON.stringify(q), {headers: header})
  } else {
    return serveDir(r, {quiet: 'True'})
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

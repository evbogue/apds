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
      await apds.add(m.data)
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
  const q = await apds.query(key)
  if (db[key]) {
    const ar = db[key]
    return new Response(JSON.stringify(ar), {headers: header})
  }
  if (key === 'all') {
    const q = await apds.query()
    return new Response(JSON.stringify(q), {headers: header})
  }
  if (q && q[0]) {
    return new Response(JSON.stringify(q), {headers: header})
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

import { apds } from './apds.js'
import { render } from './trender.js'

await apds.start(Deno.args[0] || 'default')

const sockets = new Set()

const handle = async (ws) => {
  ws.onopen = () => {
    console.log('Connection opened')
  }

  ws.onmessage = async (m) => {
    if (m.data.length === 44) {
      setTimeout(async () => {
        try { await render(m.data)} catch (err) { console.log(err)} 
      }, 100)
    } else {
      try {
        await apds.make(m.data) 
        await apds.add(m.data)
      } catch (err) { console.log(err)}
    }
    sockets.forEach(s => s.send(m.data))
  }

  ws.onclose = () => {
    console.log('Connection closed') 
  }
}

Deno.serve(
  {port: Deno.args[0] || 8080},
  async (r) => {
  try {
    const { socket, response } = Deno.upgradeWebSocket(r)
    await handle(socket)
    sockets.add(socket)
    return response
  } catch (err) {}
})

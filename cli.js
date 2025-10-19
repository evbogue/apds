import { apds } from './apds.js'

await apds.start(Deno.args[0] || 'default')
const pk = await apds.pubkey()

const sockets = new Set()

const send = async (hash) => {
  const msg = await apds.get(hash)
  const opened = await apds.open(msg)
  const blob = await apds.get(opened.substring(13))
  sockets.forEach(s => s.send(blob))
  sockets.forEach(s => s.send(msg))
  sockets.forEach(s => s.send(hash))
}

const render = async (h) => {
  const get = await apds.get(h)
  const opened = await apds.open(get)
  const blob = await apds.get(opened.substring(13))
  const yaml = await apds.parseYaml(blob)
  //console.log(yaml)
  const handle = yaml.name ? get.substring(0, 10) + ' ' + yaml.name : get.substring(0, 10)
  console.log(`%c${handle} %c| ${yaml.body} -- %c${opened.substring(0, 13)}`, 'color: magenta', 'color: white', 'color: cyan')
  //console.log(opened)
  //console.log(blob)
} 

const commands = async (c) => {
  if (c.startsWith('nick')) { 
    const ar = c.split(' ')
    if (ar[1]) {
      await apds.put('name', ar[1])
      console.log('You are now known as "' + ar[1] + '"')
    } else {
      console.log('ERROR: no nick to set')
    }
  }
  if (c.startsWith('connect')) {
    const ar = c.split(' ')
    const s = ar[1]
    console.log('Connecting to ' + s)
    const ws = new WebSocket(s)
    ws.onopen = () => {
      console.log('Connected to: ' + s)
      sockets.add(ws)
    }
  } 
  if (c.startsWith('clear')) {
    const cleared = await apds.clear()
    console.log('ERASING ALL DATA')
  }
  if (c.startsWith('exit')) {
    console.log('EXITING APDS') 
    Deno.exit()
  }
}

const flow = async () => {
  const name = await apds.get('name')
  const pub = await apds.pubkey()
  const handle = name ? pub.substring(0, 10) + ' ' + name : pub.substring(0, 10)
  const command = prompt(handle + '>')
  if (command.startsWith('/')) {
    await commands(command.substring(1))
    await flow()
  } else if (command.length > 0) { 
    const anmsg = await apds.compose(command)
    await render(anmsg)
    await send(anmsg)
    await flow()
  } else {
    await flow()
  }
}

if (pk) {
  console.log('ANPROTO APDS ACTIVATED -- Your pubkey is: ' + pk)
  await flow()
} else {
  const kp = await apds.generate()
  await apds.put('keypair', kp)
  console.log('ANPROTO APDS ACTIVATED -- No keypair found!')
  console.log('New keypair generated! ' + await apds.pubkey())
  await flow()
}


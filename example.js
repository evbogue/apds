import { apds } from './apds.js'
import { profile } from './profile.js'
import { composer } from './composer.js' 
import { render } from './render.js'

await apds.start('apds1')

if (!await apds.pubkey()) { 
  const keypair = await apds.generate()
  console.log(keypair)
  await apds.put('keypair', keypair)
}

document.body.appendChild(await profile())
document.body.appendChild(await composer())

const scroller = document.createElement('div')
scroller.id = 'scroller'

document.body.appendChild(scroller)

const log = await apds.query()

log.forEach(async (obj) => {
  await render.hash(obj.hash, scroller)
})

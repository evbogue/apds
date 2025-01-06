import { bogbot } from './bogbot.js'
import { profile } from './profile.js'
import { composer } from './composer.js' 
import { render } from './render.js'

await bogbot.start('bog5example')

if (!await bogbot.pubkey()) { 
  const keypair = await bogbot.generate()
  await bogbot.put('keypair', keypair)
}

document.body.appendChild(await profile())
document.body.appendChild(await composer())

const scroller = document.createElement('div')
scroller.id = 'scroller'

document.body.appendChild(scroller)

const log = await bogbot.query()

log.forEach(async (obj) => {
  await render.hash(obj.hash, scroller)
})

const search = await bogbot.query('?hello world')

console.log(search)

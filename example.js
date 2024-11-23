import { bogbot } from './bogbot.js'

const ta = document.createElement('textarea')

ta.placeholder = 'Write a message'

document.body.appendChild(ta)

const b = document.createElement('button')

b.textContent = 'Sign'

b.onclick = async () => {
  const signed = await bogbot.sign(ta.value)
  const el = document.createElement('div')
  el.textContent = signed
  document.body.appendChild(el)
}

document.body.appendChild(b)



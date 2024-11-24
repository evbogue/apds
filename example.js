import { bogbot } from './bogbot.js'

const na = document.createElement('input')

na.placeholder = localStorage.getItem('name') || await bogbot.pubkey()

const nb = document.createElement('button')

nb.textContent = 'Save'

nb.onclick = () => {
  localStorage.setItem('name', na.value)
  na.placeholder = na.value 
  na.value = ''
}

document.body.appendChild(na)
document.body.appendChild(nb)

const ta = document.createElement('textarea')

ta.placeholder = 'Write a message'

document.body.appendChild(ta)

const b = document.createElement('button')

b.textContent = 'Sign'

b.onclick = async () => {
  const yaml = await bogbot.compose(ta.value)    
  const signed = await bogbot.sign(yaml)
  const el = document.createElement('div')
  el.textContent = yaml + '\n\n' + signed
  document.body.appendChild(el)
}

document.body.appendChild(b)



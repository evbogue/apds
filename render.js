export const render = async (hash) => {
  const div = document.createElement('div') 

  div.textContent = hash

  return div 
}

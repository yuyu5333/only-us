;(function () {
  'use strict'

  const { emptyList, validateList, changeList, openRepository } = window.TogetherGitHub
  const byId = id => document.getElementById(id)
  const route = location.pathname.replace(/\/index\.html$/, '/')
  const previewKey = 'only-us:preview:' + route
  const connectionKey = 'only-us:connection:' + route
  const copy = {
    plans: { placeholder: '比如，一起去逛逛书店', empty: '把下次见面想做的事记在这里。' },
    meals: { placeholder: '比如，去吃那家火锅', empty: '记下想一起去吃的店。' },
    home: { placeholder: '比如，一起包饺子', empty: '记下想一起做的菜。' },
  }

  const itemInput = byId('item-input')
  const notice = byId('notice')
  const connections = byId('connection-dialog')
  const refreshButton = byId('refresh-button')
  const categoryButtons = [...document.querySelectorAll('[data-category]')]
  let list = getPreview()
  let category = 'plans'
  let mealType = 'meals'
  const mealButtons = [...document.querySelectorAll('[data-meal]')]
  const activeCategory = () => category === 'meals' ? mealType : category
  let client = null
  let profile = null
  let busy = false
  let refreshing = false
  let generation = 0
  let addDraft = null
  let editItem = null
  let deleteItem = null
  let originalDate = ''

  function getPreview() {
    try {
      const raw = localStorage.getItem(previewKey)
      return raw ? validateList(JSON.parse(raw)) : emptyList()
    } catch {
      return emptyList()
    }
  }

  function rememberedConnection() {
    try {
      const current = sessionStorage.getItem(connectionKey) || localStorage.getItem(connectionKey)
      const data = current && JSON.parse(current)
      if (typeof data?.repository === 'string' && typeof data?.token === 'string') return data
    } catch {
      // The connection can still be entered manually when browser storage is unavailable.
    }
    return null
  }

  function forgetConnection() {
    for (const name of ['sessionStorage', 'localStorage']) {
      try {
        window[name].removeItem(connectionKey)
      } catch {
        // The current browser session can still be disconnected.
      }
    }
  }

  function rememberConnection(details) {
    forgetConnection()
    try {
      const storage = details.remember ? localStorage : sessionStorage
      storage.setItem(connectionKey, JSON.stringify(details))
      return true
    } catch {
      return false
    }
  }

  function message(element, text = '', success = false) {
    element.classList.toggle('success', success)
    element.textContent = text
    element.hidden = !text
  }

  function today() {
    const date = new Date()
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
      .map(part => String(part).padStart(2, '0')).join('-')
  }

  function renderDate() {
    const dateLabel = byId('date-label')
    const dateHint = byId('date-hint')
    byId('date-button').textContent = list.meetDate ? '修改日期' : '选择日期'
    if (!list.meetDate) {
      dateLabel.textContent = '还没定日期'
      message(dateHint)
      return
    }

    const [year, month, day] = list.meetDate.split('-').map(Number)
    const difference = (Date.parse(list.meetDate) - Date.parse(today())) / 86400000
    const yearLabel = year === new Date().getFullYear() ? '' : year + '年'
    dateLabel.textContent = yearLabel + month + '月' + day + '日'
    if (difference > 0) message(dateHint, '还有 ' + difference + ' 天')
    else if (difference === 0) message(dateHint, '今天就见面')
    else message(dateHint, '见面日期已过')
  }

  function render() {
    const status = byId('sync-state')
    status.textContent = client ? 'GitHub 已连接' : '本机预览'
    status.classList.toggle('connected', Boolean(client))
    byId('connect-button').textContent = client ? '连接设置' : '连接 GitHub'
    refreshButton.hidden = !client
    renderDate()
    renderItems()
    updateControls()
  }

  function renderItems() {
    const current = activeCategory()
    const items = list.items.filter(item => item.category === current)
    const completed = items.filter(item => item.done).length
    byId('plans-count').textContent = list.items.filter(item => item.category === 'plans').length
    byId('meals-count').textContent = list.items.filter(item => item.category !== 'plans').length
    byId('meal-types').hidden = category !== 'meals'
    for (const button of mealButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.meal === mealType))
    }
    for (const button of categoryButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.category === category))
    }
    itemInput.placeholder = copy[current].placeholder

    byId('list-progress').hidden = !items.length
    byId('progress-text').textContent = '已完成 ' + completed + ' / ' + items.length
    const progress = byId('progress-bar')
    progress.max = items.length || 1
    progress.value = completed
    message(byId('empty-message'), items.length ? '' : copy[current].empty)
    byId('items').replaceChildren(...items.map(makeItem))
  }

  function makeItem(item) {
    const row = document.createElement('li')
    row.className = 'item'
    row.dataset.done = String(item.done)
    const label = document.createElement('label')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = item.done
    checkbox.addEventListener('change', async () => {
      const saved = await save({ type: 'toggle', id: item.id, done: checkbox.checked })
      if (!saved) checkbox.checked = item.done
    })
    const text = document.createElement('span')
    text.className = 'item-text'
    text.textContent = item.text
    label.append(checkbox, text)

    const actions = document.createElement('div')
    actions.className = 'item-actions'
    const edit = itemButton('编辑', item, () => openEdit(item))
    const remove = itemButton('删除', item, () => openDelete(item))
    remove.classList.add('danger')
    actions.append(edit, remove)
    row.append(label, actions)
    return row
  }

  function itemButton(title, item, action) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button text-button'
    button.textContent = title
    button.setAttribute('aria-label', title + ' ' + item.text)
    button.addEventListener('click', action)
    return button
  }

  function updateControls() {
    for (const element of document.querySelectorAll(
      '.composer input, .item input, .item button, .dialog-content input, ' +
      '.dialog-actions button, #connect-button, #date-button, [data-category], [data-meal], #edit-meal'
    )) {
      element.disabled = busy
    }
    refreshButton.disabled = busy || refreshing
    byId('add-form').querySelector('button').disabled = busy || !itemInput.value.trim()
  }

  async function refresh(quiet = false) {
    if (!client || busy || refreshing) return
    refreshing = true
    updateControls()
    const marker = generation
    try {
      const next = await client.load()
      if (marker !== generation) return
      if (JSON.stringify(next) !== JSON.stringify(list)) {
        list = next
        render()
      } else {
        renderDate()
      }
      message(notice, quiet ? '' : '清单已刷新。', !quiet)
    } catch (error) {
      if (marker === generation) message(notice, error.message)
    } finally {
      refreshing = false
      updateControls()
    }
  }

  async function save(change, errorElement = notice) {
    if (busy) return false
    generation += 1
    busy = true
    updateControls()
    message(errorElement)
    try {
      if (client) {
        list = await client.apply(change)
      } else {
        const next = changeList(list, change)
        localStorage.setItem(previewKey, JSON.stringify(next))
        list = next
      }
      render()
      message(notice)
      return true
    } catch (error) {
      message(errorElement, error.message || '保存失败，请重试。')
      return false
    } finally {
      busy = false
      updateControls()
    }
  }

  async function connect(details, errorElement) {
    if (busy) return
    generation += 1
    busy = true
    updateControls()
    byId('connect-submit').textContent = '连接中…'
    message(errorElement)
    try {
      const nextClient = openRepository(details.repository, details.token)
      const nextList = await nextClient.load()
      client = nextClient
      list = nextList
      profile = { repository: details.repository, remember: details.remember }
      addDraft = null
      itemInput.value = ''
      if (connections.open) connections.close()
      const stored = rememberConnection(details)
      message(notice, stored ? '' : '已连接。浏览器限制了令牌保存，本次打开期间仍可使用。')
      render()
    } catch (error) {
      message(errorElement, error.message)
    } finally {
      busy = false
      byId('connect-submit').textContent = '连接'
      updateControls()
    }
  }

  function newItemId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }

  function openEdit(item) {
    editItem = item
    byId('edit-input').value = item.text
    byId('edit-meal-label').hidden = byId('edit-meal').hidden = item.category === 'plans'
    byId('edit-meal').value = item.category
    message(byId('edit-error'))
    byId('edit-dialog').showModal()
  }

  function openDelete(item) {
    deleteItem = item
    byId('delete-text').textContent = item.text
    message(byId('delete-error'))
    byId('delete-dialog').showModal()
  }

  for (const button of categoryButtons) {
    button.addEventListener('click', () => {
      if (category === button.dataset.category) return
      category = button.dataset.category
      renderItems()
    })
  }

  itemInput.addEventListener('input', updateControls)
  for (const button of mealButtons) {
    button.addEventListener('click', () => {
      mealType = button.dataset.meal
      renderItems()
    })
  }
  byId('add-form').addEventListener('submit', async event => {
    event.preventDefault()
    const text = itemInput.value.trim()
    if (!text || busy) return
    const current = activeCategory()
    if (!addDraft || addDraft.text !== text || addDraft.category !== current) {
      addDraft = { type: 'add', id: newItemId(), category: current, text }
    }
    if (await save(addDraft)) {
      addDraft = null
      itemInput.value = ''
      updateControls()
      itemInput.focus()
    }
  })

  byId('edit-form').addEventListener('submit', async event => {
    event.preventDefault()
    const change = {
      type: 'edit', id: editItem.id, previous: editItem.text, text: byId('edit-input').value.trim(),
      previousCategory: editItem.category,
      category: editItem.category === 'plans' ? 'plans' : byId('edit-meal').value,
    }
    if (await save(change, byId('edit-error'))) byId('edit-dialog').close()
  })
  byId('delete-form').addEventListener('submit', async event => {
    event.preventDefault()
    const change = { type: 'remove', id: deleteItem.id, previous: deleteItem.text }
    if (await save(change, byId('delete-error'))) byId('delete-dialog').close()
  })

  byId('date-button').addEventListener('click', () => {
    originalDate = list.meetDate
    byId('date-input').value = originalDate || today()
    byId('clear-date').hidden = !originalDate
    message(byId('date-error'))
    byId('date-dialog').showModal()
  })
  async function saveDate(value) {
    const change = { type: 'date', value, previous: originalDate }
    if (await save(change, byId('date-error'))) byId('date-dialog').close()
  }
  byId('date-form').addEventListener('submit', event => {
    event.preventDefault()
    saveDate(byId('date-input').value)
  })
  byId('clear-date').addEventListener('click', () => saveDate(''))

  byId('connect-button').addEventListener('click', () => {
    const previous = profile || rememberedConnection()
    byId('repo-input').value = previous?.repository || ''
    byId('token-input').value = ''
    byId('remember-input').checked = Boolean(previous?.remember)
    byId('disconnect-button').hidden = !client && !previous
    message(byId('connection-error'))
    connections.showModal()
  })
  byId('connection-form').addEventListener('submit', event => {
    event.preventDefault()
    const details = {
      repository: byId('repo-input').value.trim(),
      token: byId('token-input').value.trim(),
      remember: byId('remember-input').checked,
    }
    connect(details, byId('connection-error'))
  })
  connections.addEventListener('close', () => { byId('token-input').value = '' })
  byId('disconnect-button').addEventListener('click', () => {
    generation += 1
    forgetConnection()
    client = null
    profile = null
    addDraft = null
    itemInput.value = ''
    list = getPreview()
    connections.close()
    message(notice)
    render()
  })

  for (const button of document.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => byId(button.dataset.close).close())
  }
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('cancel', event => {
      if (busy) event.preventDefault()
    })
  }

  refreshButton.addEventListener('click', () => refresh())
  const refreshVisible = () => {
    if (document.visibilityState === 'visible') refresh(true)
  }
  window.addEventListener('focus', refreshVisible)
  window.addEventListener('online', refreshVisible)
  document.addEventListener('visibilitychange', refreshVisible)
  window.setInterval(refreshVisible, 45000)

  render()
  const remembered = rememberedConnection()
  if (remembered) connect(remembered, notice)
})()

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
    home: { placeholder: '比如，一起做番茄鸡蛋面', empty: '记下想一起做的菜。' },
  }

  const groupContainer = byId('list-groups')
  const groups = [...groupContainer.querySelectorAll('[data-group]')].map(panel => {
    const kind = panel.dataset.group
    panel.append(byId('group-content').content.cloneNode(true))
    const form = panel.querySelector('.composer')
    const input = form.querySelector('input')
    input.placeholder = copy[kind].placeholder
    input.setAttribute('aria-label', (panel.querySelector('h2')?.textContent || '要做的事') + '的新条目')
    return { kind, panel, form, input, items: panel.querySelector('.items'), draft: null }
  })
  const notice = byId('notice')
  const connections = byId('connection-dialog')
  const refreshButton = byId('refresh-button')
  const categoryButtons = [...document.querySelectorAll('[data-category]')]
  let list = getPreview()
  let category = 'plans'
  let client = null
  let profile = null
  let busy = false
  let refreshing = false
  let generation = 0
  let editItem = null
  let deleteItem = null
  let originalDate = ''
  let drag = null

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
    clearDrag()
    byId('plans-count').textContent = list.items.filter(item => item.category === 'plans').length
    byId('meals-count').textContent = list.items.filter(item => item.category !== 'plans').length
    for (const button of categoryButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.category === category))
    }
    for (const group of groups) {
      const { kind, panel } = group
      panel.hidden = (kind === 'plans' ? 'plans' : 'meals') !== category
      if (panel.hidden) continue
      const items = list.items.filter(item => item.category === kind)
      const completed = items.filter(item => item.done).length
      const progress = panel.querySelector('.list-progress')
      progress.hidden = !items.length
      progress.querySelector('p').textContent = '已完成 ' + completed + ' / ' + items.length
      const bar = progress.querySelector('progress')
      bar.max = items.length || 1
      bar.value = completed
      message(panel.querySelector('.empty-message'), items.length ? '' : copy[kind].empty)
      group.items.replaceChildren(...items.map(item => makeItem(item, items.length > 1)))
    }
  }

  function makeItem(item, sortable) {
    const row = document.createElement('li')
    row.className = 'item'
    row.dataset.done = String(item.done)
    row.dataset.id = item.id
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
    if (sortable) {
      const handle = document.createElement('button')
      handle.type = 'button'
      handle.className = 'sort-handle'
      handle.textContent = '⠿'
      handle.title = '拖动排序，也可用上下方向键移动'
      handle.setAttribute('aria-label', '调整「' + item.text + '」的顺序，使用上下方向键移动')
      row.prepend(handle)
    }
    return row
  }

  function clearDrag() {
    if (!drag) return
    const { row, itemList, pointerId, frame } = drag
    drag = null
    cancelAnimationFrame(frame)
    row.classList.remove('dragging')
    row.style.removeProperty('transform')
    itemList.classList.remove('sorting')
    if (itemList.hasPointerCapture(pointerId)) itemList.releasePointerCapture(pointerId)
  }

  function positionDraggedRow() {
    const { row, itemList, y, grabOffset } = drag
    const before = [...itemList.children].find(other => {
      if (other === row) return false
      const rect = other.getBoundingClientRect()
      return y < rect.top + rect.height / 2
    }) || null
    if (row.nextElementSibling !== before) itemList.insertBefore(row, before)
    const top = Math.max(0, Math.min(itemList.clientHeight - row.offsetHeight,
      y - itemList.getBoundingClientRect().top - grabOffset))
    row.style.transform = 'translateY(' + (top - row.offsetTop) + 'px)'
  }

  function scrollWhileDragging() {
    drag.frame = 0
    const edge = 56
    const y = drag.y
    const speed = y < edge ? y - edge : Math.max(0, y - (innerHeight - edge))
    if (!speed) return
    const previous = window.scrollY
    window.scrollBy(0, Math.sign(speed) * Math.min(18, Math.ceil(Math.abs(speed) / 3)))
    if (window.scrollY === previous) return
    positionDraggedRow()
    drag.frame = requestAnimationFrame(scrollWhileDragging)
  }

  groupContainer.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.sort-handle')
    if (!handle || busy || drag || !event.isPrimary || event.button !== 0) return
    const row = handle.closest('.item')
    const itemList = row.parentElement
    drag = { row, itemList, pointerId: event.pointerId, startY: event.clientY, y: event.clientY,
      grabOffset: event.clientY - row.getBoundingClientRect().top,
      originalNext: row.nextElementSibling, moving: false, frame: 0 }
    itemList.setPointerCapture(event.pointerId)
  })

  groupContainer.addEventListener('pointermove', event => {
    if (drag?.pointerId !== event.pointerId) return
    drag.y = event.clientY
    if (!drag.moving && Math.abs(drag.y - drag.startY) < 4) return
    drag.moving = true
    drag.row.classList.add('dragging')
    drag.itemList.classList.add('sorting')
    positionDraggedRow()
    if (!drag.frame) drag.frame = requestAnimationFrame(scrollWhileDragging)
  })

  async function savePosition(row, before) {
    const id = row.dataset.id
    const category = row.closest('[data-group]').dataset.group
    const saved = await save({ type: 'move', category, id, before: before?.dataset.id ?? null })
    if (!saved) renderItems()
  }

  groupContainer.addEventListener('pointerup', event => {
    if (drag?.pointerId !== event.pointerId) return
    const { row, originalNext, moving } = drag
    if (moving) {
      drag.y = event.clientY
      positionDraggedRow()
    }
    clearDrag()
    if (moving && row.nextElementSibling !== originalNext) savePosition(row, row.nextElementSibling)
  })

  function cancelDrag() {
    if (drag) renderItems()
  }
  for (const type of ['pointercancel', 'lostpointercapture']) {
    groupContainer.addEventListener(type, event => {
      if (drag?.pointerId === event.pointerId) cancelDrag()
    })
  }
  window.addEventListener('blur', cancelDrag)
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancelDrag()
  })
  groupContainer.addEventListener('keydown', async event => {
    if (!event.target.matches('.sort-handle') || busy || drag) return
    const row = event.target.closest('.item')
    const up = event.key === 'ArrowUp'
    if (!up && event.key !== 'ArrowDown') return
    event.preventDefault()
    const neighbor = up ? row.previousElementSibling : row.nextElementSibling
    if (!neighbor) return
    const itemList = row.parentElement
    await savePosition(row, up ? neighbor : neighbor.nextElementSibling)
    itemList.querySelector('[data-id="' + row.dataset.id + '"] .sort-handle')?.focus()
  })

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
      '.dialog-actions button, #connect-button, #date-button, [data-category], #edit-meal'
    )) {
      element.disabled = busy
    }
    refreshButton.disabled = busy || refreshing
    for (const { form, input } of groups) {
      form.querySelector('button').disabled = busy || !input.value.trim()
    }
  }

  async function refresh(quiet = false) {
    if (!client || busy || refreshing || drag) return
    refreshing = true
    updateControls()
    const marker = generation
    try {
      const next = await client.load()
      if (marker !== generation || drag) return
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
      resetDrafts()
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

  function resetDrafts() {
    for (const group of groups) {
      group.draft = null
      group.input.value = ''
    }
  }

  for (const group of groups) {
    const { form, input, kind } = group
    input.addEventListener('input', updateControls)
    form.addEventListener('submit', async event => {
      event.preventDefault()
      const text = input.value.trim()
      if (!text || busy) return
      if (group.draft?.text !== text) {
        group.draft = { type: 'add', id: newItemId(), category: kind, text }
      }
      if (await save(group.draft)) {
        group.draft = null
        input.value = ''
        updateControls()
        input.focus()
      }
    })
  }

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
    resetDrafts()
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

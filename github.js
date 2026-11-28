;(function (root) {
  'use strict'

  const FILE = 'meeting-list.json'
  const CATEGORIES = ['plans', 'meals', 'home']
  const MAX_ITEMS = 200
  const API_ROOT = 'https://api.github.com/repos'

  class GitHubError extends Error {
    constructor(message, status) {
      super(message)
      this.status = status
    }
  }

  function emptyList() {
    return { version: 1, meetDate: '', items: [] }
  }

  function validDate(date) {
    if (date === '') return true
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
    if (date < '1900-01-01' || date > '2100-12-31') return false
    const parsed = new Date(date)
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date
  }

  function validText(text) {
    return typeof text === 'string' && text.trim() === text && text.length > 0 && text.length <= 80
  }

  function validateList(list) {
    if (!list || list.version !== 1 || !validDate(list.meetDate) ||
        !Array.isArray(list.items) || list.items.length > MAX_ITEMS) {
      throw new Error('清单文件格式有误，请检查 GitHub 中的 meeting-list.json。')
    }

    const ids = new Set()
    const items = list.items.map(item => {
      if (!item || typeof item.id !== 'string' || !/^[a-f0-9-]{16,64}$/.test(item.id) ||
          ids.has(item.id) || !validText(item.text) || !CATEGORIES.includes(item.category) ||
          typeof item.done !== 'boolean') {
        throw new Error('清单文件里有无法读取的条目。')
      }
      ids.add(item.id)
      return { id: item.id, text: item.text, category: item.category, done: item.done }
    })
    return { version: 1, meetDate: list.meetDate, items }
  }

  function changeList(list, change) {
    if (change.type === 'date') {
      if (!validDate(change.value)) throw new Error('请选择有效的日期。')
      if (list.meetDate === change.value) return list
      if (list.meetDate !== change.previous) throw new Error('日期已被修改，请刷新清单后重试。')
      return { ...list, meetDate: change.value }
    }

    const existing = list.items.find(item => item.id === change.id)
    if (change.type === 'add') {
      if (existing) return list
      if (!validText(change.text) || !CATEGORIES.includes(change.category)) {
        throw new Error('请输入 1 到 80 字，并选择清单分类。')
      }
      if (list.items.length >= MAX_ITEMS) throw new Error('清单已满，请先删减一些条目。')
      const item = { id: change.id, text: change.text, category: change.category, done: false }
      return { ...list, items: [...list.items, item] }
    }
    if (!existing) {
      if (change.type === 'remove') return list
      throw new Error('这条内容已删除，请刷新清单。')
    }

    if (change.type === 'toggle') {
      if (existing.done === change.done) return list
      return {
        ...list,
        items: list.items.map(item => item.id === change.id ? { ...item, done: change.done } : item),
      }
    }
    const category = change.category ?? existing.category
    if (change.type === 'edit') {
      if (!CATEGORIES.includes(category)) throw new Error('请选择清单分类。')
      if (existing.text === change.text && existing.category === category) return list
      if (change.previousCategory && existing.category !== change.previousCategory) {
        throw new Error('这条内容的分类已修改，请刷新清单后重新操作。')
      }
    }
    if (existing.text !== change.previous) {
      throw new Error('这条内容已被修改，请刷新清单后重新操作。')
    }
    if (change.type === 'remove') {
      return { ...list, items: list.items.filter(item => item.id !== change.id) }
    }
    if (change.type === 'edit' && validText(change.text)) {
      return {
        ...list,
        items: list.items.map(item => item.id === change.id ? { ...item, text: change.text, category } : item),
      }
    }
    throw new Error('请输入 1 到 80 字。')
  }

  function encodeFile(list) {
    const bytes = new TextEncoder().encode(JSON.stringify(list, null, 2) + '\n')
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }

  function decodeFile(content) {
    const bytes = Uint8Array.from(atob(content.replace(/\s/g, '')), letter => letter.charCodeAt(0))
    return validateList(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  }

  function errorFor(response) {
    const status = response.status
    let message = 'GitHub 暂时无法完成此操作。'
    if (status === 401) message = 'GitHub 令牌无效或已过期，请重新连接。'
    if (status === 403) message = 'GitHub 拒绝访问，请检查令牌的仓库和 Contents 读写权限。'
    if (status === 404) message = '找不到数据仓库，请检查仓库名称和令牌权限。'
    if (status === 409) message = '仓库尚未初始化，或清单正在更新。请确认仓库已有初始提交。'
    if (status === 422) message = 'GitHub 未保存清单，请检查默认分支和写入权限。'
    if (status === 429 || response.headers.get('X-RateLimit-Remaining') === '0') {
      message = 'GitHub 请求已达限额，请稍后再试。'
    }
    return new GitHubError(message, status)
  }

  function openRepository(repository, token, send = fetch) {
    const repo = repository.trim()
    const secret = token.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) ||
        repo.endsWith('/.') || repo.endsWith('/..')) {
      throw new Error('仓库名请按「用户名/仓库名」填写。')
    }
    if (!/^github_pat_[A-Za-z0-9_]+$/.test(secret)) {
      throw new Error('请输入以 github_pat_ 开头的细粒度令牌。')
    }

    const endpoint = API_ROOT + '/' + repo.split('/').map(encodeURIComponent).join('/')
    const contents = endpoint + '/contents/' + FILE

    async function request(url, method = 'GET', data) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const headers = {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + secret,
          'X-GitHub-Api-Version': '2022-11-28',
        }
        const options = {
          method, headers, cache: 'no-store', credentials: 'omit',
          redirect: 'error', signal: controller.signal,
        }
        if (data) {
          headers['Content-Type'] = 'application/json'
          options.body = JSON.stringify(data)
        }
        return await send(url, options)
      } catch {
        throw new Error('连接 GitHub 失败，请检查网络后重试。')
      } finally {
        clearTimeout(timer)
      }
    }

    async function checkRepository() {
      const response = await request(endpoint)
      if (!response.ok) throw errorFor(response)
      const details = await response.json()
      if (details.private !== true) throw new Error('请使用私有仓库存放你们的清单。')
      if (details.archived === true) throw new Error('这个仓库已归档，请选择可编辑的私有仓库。')
    }

    async function read() {
      const response = await request(contents)
      if (response.status === 404) return { list: emptyList(), sha: null }
      if (!response.ok) throw errorFor(response)
      const file = await response.json()
      if (file.type !== 'file' || file.encoding !== 'base64' ||
          typeof file.content !== 'string' || typeof file.sha !== 'string') {
        throw new Error('GitHub 中的清单文件无法读取。')
      }
      try {
        return { list: decodeFile(file.content), sha: file.sha }
      } catch {
        throw new Error('清单文件格式有误，请检查 GitHub 中的 meeting-list.json。')
      }
    }

    async function load() {
      await checkRepository()
      return (await read()).list
    }

    async function apply(change) {
      await checkRepository()
      let snapshot = await read()
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const next = changeList(snapshot.list, change)
        if (next === snapshot.list) return next

        const body = { message: '更新见面清单', content: encodeFile(next) }
        if (snapshot.sha) body.sha = snapshot.sha
        const response = await request(contents, 'PUT', body)
        if (response.ok) return next
        if (response.status !== 409 && response.status !== 422) throw errorFor(response)

        const latest = await read()
        if (latest.sha === snapshot.sha) throw errorFor(response)
        snapshot = latest
      }
      throw new Error('刚好有多次同时更新，请刷新清单后重试。')
    }

    return { load, apply }
  }

  const api = { emptyList, validateList, changeList, openRepository }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.TogetherGitHub = api
})(globalThis)

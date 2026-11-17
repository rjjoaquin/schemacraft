import {
  actions, column, defaultsFor, emptyProject, endpoints, exportPrisma, exportSql,
  labels, limits, newId, readProject, sampleProject, validate,
} from './schema.js'

const $ = (id) => document.getElementById(id)
const canvas = $('canvas')
const board = $('board')
const nodes = $('nodes')
const edges = $('edges')
const inspector = $('inspector-body')
const storageKey = 'schemacraft.project.v1'
const width = 228
const headerHeight = 40
const rowHeight = 29
const padding = 48
const defaultLabels = { '': 'None', identity: 'Auto-increment', now: 'Current time', uuid: 'Random UUID' }
const actionLabels = { Restrict: 'Restrict', Cascade: 'Cascade', SetNull: 'Set null', NoAction: 'No action' }
const identifier = /^[A-Za-z][A-Za-z0-9_]{0,62}$/
const position = (value) => Math.max(0, Math.min(limits.position, Math.round(value)))

let project = emptyProject()
let selectedTable = null
let selectedColumn = null
let editingLink = null
let toastTimer

function element(tag, className = '', value = '') {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = value
  return node
}

function button(value, className, handler) {
  const node = element('button', className, value)
  node.type = 'button'
  node.addEventListener('click', handler)
  return node
}

function setSaveStatus(message, error = false) {
  const status = $('save-status')
  if (status.textContent !== message) status.textContent = message
  status.toggleAttribute('data-error', error)
}

function load() {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved !== null) project = readProject(saved)
    setSaveStatus('Saved on this device')
  } catch {
    setSaveStatus('Saved project unavailable', true)
    notify('The saved project could not be loaded.')
  }
}

function save() {
  try {
    const data = JSON.stringify(project)
    if (data.length > limits.storage) throw new Error('Storage limit')
    localStorage.setItem(storageKey, data)
    setSaveStatus('Saved on this device')
  } catch {
    setSaveStatus('Changes could not be saved', true)
    if ($('notification').textContent !== 'Changes could not be saved on this device.') {
      notify('Changes could not be saved on this device.')
    }
  }
}

function notify(message) {
  clearTimeout(toastTimer)
  $('notification').textContent = message
  toastTimer = setTimeout(() => { $('notification').textContent = '' }, 4200)
}

const tableById = (id) => project.tables.find((table) => table.id === id)
const tableName = (table) => table?.name || 'Unnamed table'
const fieldName = (field) => field?.name || 'Unnamed column'
const count = (total, noun) => `${total} ${noun}${total === 1 ? '' : 's'}`

function updateDiagram() {
  $('diagram-summary').textContent = `${count(project.tables.length, 'table')} · ${count(project.links.length, 'relationship')}`
  $('add-table').disabled = project.tables.length >= limits.tables
  $('add-link').disabled = !project.tables.some((table) => table.columns.length) || project.links.length >= limits.links
  $('empty').hidden = project.tables.length > 0
  board.hidden = project.tables.length === 0
  const foreignKeys = new Set(project.links.map((link) => link.fromColumn))
  nodes.replaceChildren(...project.tables.map((table) => drawTable(table, foreignKeys)))
  resizeBoard()
  drawEdges()
}

function placeNode(card, table) {
  card.style.left = `${table.x}px`
  card.style.top = `${table.y}px`
}

function drawTable(table, foreignKeys) {
  const card = element('article', 'table-node')
  card.dataset.table = table.id
  placeNode(card, table)
  card.classList.toggle('selected', table.id === selectedTable)
  const handle = button('', 'node-header', () => selectTable(table.id))
  handle.setAttribute('aria-pressed', String(table.id === selectedTable))
  handle.title = 'Drag to move, or use the arrow keys'
  handle.append(element('span', 'node-name', tableName(table)))
  enableDragging(handle, card, table)
  card.append(handle)
  for (const field of table.columns) {
    const row = element('div', 'node-column')
    const name = element('span', 'node-column-name', fieldName(field))
    name.title = fieldName(field)
    const flags = [field.primary && 'PK', foreignKeys.has(field.id) && 'FK', field.unique && !field.primary && 'UQ'].filter(Boolean)
    if (flags.length) name.append(element('span', 'key-label', flags.join(' · ')))
    row.append(name, element('span', 'node-type', labels[field.type]))
    card.append(row)
  }
  return card
}

function resizeBoard() {
  const right = Math.max(0, ...project.tables.map((table) => table.x + width + padding))
  const bottom = Math.max(0, ...project.tables.map((table) => table.y + headerHeight + rowHeight * table.columns.length + padding))
  board.style.width = `${right}px`
  board.style.height = `${bottom}px`
}

function svg(tag, attributes) {
  const shape = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value)
  return shape
}

function drawEdges() {
  const shapes = []
  for (const link of project.links) {
    const { source, target, from, to } = endpoints(project, link)
    if (!from || !to) continue
    const y1 = source.y + headerHeight + rowHeight * (source.columns.indexOf(from) + .5)
    const y2 = target.y + headerHeight + rowHeight * (target.columns.indexOf(to) + .5)
    const same = source.id === target.id
    const direction = target.x >= source.x ? 1 : -1
    const x1 = source.x + (direction === 1 ? width : 0)
    const x2 = target.x + (same || direction === -1 ? width : 0)
    const curve = same ? 40 : Math.max(28, Math.abs(x2 - x1) * .45)
    const path = `M ${x1} ${y1} C ${x1 + curve * direction} ${y1}, ${x2 + curve * (same ? 1 : -direction)} ${y2}, ${x2} ${y2}`
    const active = [source.id, target.id].includes(selectedTable)
    shapes.push(svg('path', { d: path, class: active ? 'edge-line edge-active' : 'edge-line' }))
    for (const [cx, cy] of [[x1, y1], [x2, y2]]) {
      shapes.push(svg('circle', { cx, cy, r: 3.5, class: 'edge-end' }))
    }
  }
  edges.replaceChildren(...shapes)
}

function selectTable(id) {
  if (selectedTable === id) return
  selectedTable = id
  selectedColumn = null
  for (const card of nodes.children) {
    const active = card.dataset.table === id
    card.classList.toggle('selected', active)
    card.firstElementChild.setAttribute('aria-pressed', String(active))
  }
  drawEdges()
  renderInspector()
  inspector.scrollTop = 0
}

function enableDragging(handle, card, table) {
  let drag = null
  let moved = false
  handle.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return
    handle.setPointerCapture(event.pointerId)
    selectTable(table.id)
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: table.x, top: table.y }
    moved = false
  })
  handle.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return
    moved = true
    table.x = position(drag.left + dx)
    table.y = position(drag.top + dy)
    placeNode(card, table)
    resizeBoard()
    drawEdges()
  })
  const finish = (event) => {
    if (!drag || drag.pointer !== event.pointerId) return
    drag = null
    if (moved) save()
  }
  handle.addEventListener('pointerup', finish)
  handle.addEventListener('pointercancel', finish)
  handle.addEventListener('lostpointercapture', finish)
  handle.addEventListener('keydown', (event) => {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (!Object.hasOwn(moves, event.key)) return
    event.preventDefault()
    selectTable(table.id)
    const [dx, dy] = moves[event.key]
    const step = event.shiftKey ? 48 : 12
    table.x = position(table.x + dx * step)
    table.y = position(table.y + dy * step)
    placeNode(card, table)
    resizeBoard()
    drawEdges()
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    save()
  })
}

function nextName(base, items, first = 1) {
  const names = new Set(items.map((item) => item.name))
  let index = first
  while (names.has(`${base}_${index}`)) index++
  return `${base}_${index}`
}

function addTable() {
  if (project.tables.length >= limits.tables) return
  const table = {
    id: newId(), name: nextName('table', project.tables),
    x: position(canvas.scrollLeft + 28), y: position(canvas.scrollTop + 30),
    columns: [column('id', 'integer', true)],
  }
  const maxX = Math.max(table.x, Math.min(limits.position, canvas.scrollLeft + canvas.clientWidth - width - 12))
  const maxY = Math.min(limits.position, canvas.scrollTop + canvas.clientHeight - 83)
  for (let attempt = 0; attempt < 45; attempt++) {
    if (!project.tables.some((other) => table.x + width + 12 > other.x && table.x < other.x + width + 12
      && table.y + 77 > other.y && table.y < other.y + headerHeight + other.columns.length * rowHeight + 12)) break
    table.x += width + 24
    if (table.x > maxX) {
      table.x = position(canvas.scrollLeft + 28)
      table.y += 96
    }
    if (table.y > maxY) {
      table.y = position(Math.max(...project.tables.map((other) => other.y + headerHeight + other.columns.length * rowHeight)) + 30)
      break
    }
  }
  project.tables.push(table)
  selectedTable = table.id
  selectedColumn = null
  commit()
  nodes.lastElementChild.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const name = $('table-name')
  name.focus({ preventScroll: true })
  name.select()
}

function commit(focusId) {
  save()
  updateDiagram()
  renderInspector()
  if (focusId) $(focusId)?.focus({ preventScroll: true })
}

function fieldLabel(value, input) {
  const label = element('label', '', value)
  label.append(input)
  return label
}

function setOptions(select, options, value, placeholder) {
  const rows = options.map(([id, label]) => new Option(label, id))
  if (placeholder !== undefined) rows.unshift(new Option(placeholder, ''))
  select.replaceChildren(...rows)
  if (rows.some((option) => option.value === value)) select.value = value
}

function nameInput(id, label, record, siblings, rename = () => {}) {
  const input = element('input')
  input.id = id
  input.value = record.name
  input.maxLength = 63
  input.spellcheck = false
  input.autocomplete = 'off'
  const field = fieldLabel(label, input)
  const note = element('span', 'field-note')
  note.id = `${id}-note`
  input.setAttribute('aria-describedby', note.id)
  field.append(note)
  function refreshNote() {
    const duplicate = siblings.some((item) => item !== record && item.name === record.name)
    const issue = !identifier.test(record.name) ? 'Use a letter, then letters, digits, or underscores.' : duplicate ? 'This name is already in use.' : ''
    note.textContent = issue
    input.setAttribute('aria-invalid', String(Boolean(issue)))
  }
  input.addEventListener('input', () => {
    record.name = input.value
    refreshNote()
    rename()
    updateDiagram()
    save()
  })
  refreshNote()
  return field
}

function section(title, action) {
  const block = element('section', 'inspector-section')
  const heading = element('div', 'section-heading')
  heading.append(element('h3', '', title))
  if (action) heading.append(action)
  block.append(heading)
  return block
}

function listItem(value, meta, handler) {
  const entry = button('', 'list-item', handler)
  const label = element('span', 'list-label', value)
  label.title = value
  entry.append(label, element('span', 'list-meta', meta))
  return entry
}

function renderInspector() {
  const table = tableById(selectedTable)
  if (!table) {
    inspector.replaceChildren(element('p', 'inspector-empty', project.tables.length ? 'Select a table to edit it.' : 'Table details appear here after you add or select a table.'))
    return
  }
  const names = element('section', 'inspector-section')
  names.append(nameInput('table-name', 'Table name', table, project.tables, () => {
    for (const link of project.links.filter((link) => link.fromTable === table.id || link.toTable === table.id)) {
      const label = $(`link-${link.id}`)?.firstElementChild
      if (label) label.title = label.textContent = linkTitle(link)
    }
  }))

  const add = button('Add column', 'button secondary small', () => {
    if (table.columns.length >= limits.columns) return
    const field = column(nextName('column', table.columns), 'text')
    table.columns.push(field)
    selectedColumn = field.id
    commit('column-name')
    $('column-name').scrollIntoView({ block: 'nearest' })
    $('column-name').select()
  })
  add.disabled = table.columns.length >= limits.columns
  const columns = section('Columns', add)
  const list = element('div', 'item-list')
  for (const field of table.columns) {
    const key = field.primary ? ' · PK' : field.unique ? ' · UQ' : ''
    const entry = listItem(fieldName(field), labels[field.type] + key, () => {
      selectedColumn = selectedColumn === field.id ? null : field.id
      renderInspector()
      $(`field-${field.id}`).focus({ preventScroll: true })
    })
    entry.id = `field-${field.id}`
    entry.setAttribute('aria-pressed', String(selectedColumn === field.id))
    list.append(entry)
  }
  columns.append(list)
  const field = table.columns.find((item) => item.id === selectedColumn)
  if (field) columns.append(columnEditor(table, field))

  const linkButton = button('Add', 'button secondary small', () => openLink())
  linkButton.disabled = $('add-link').disabled
  linkButton.setAttribute('aria-label', 'Add relationship')
  const relationships = section('Relationships', linkButton)
  const links = project.links.filter((link) => link.fromTable === table.id || link.toTable === table.id)
  if (!links.length) {
    relationships.append(element('p', 'inspector-note', 'No relationships yet.'))
  } else {
    const linkList = element('div', 'item-list')
    for (const link of links) {
      const item = listItem(linkTitle(link), 'Edit', () => openLink(link))
      item.id = `link-${link.id}`
      linkList.append(item)
    }
    relationships.append(linkList)
  }

  const remove = section('Table actions')
  remove.append(button('Remove table', 'button danger small', () => {
    if (!window.confirm(`Remove ${tableName(table)} and its relationships?`)) return
    deleteTable(table)
  }))
  inspector.replaceChildren(names, columns, relationships, remove)
}

function deleteTable(table) {
  project.tables = project.tables.filter((item) => item !== table)
  project.links = project.links.filter((link) => link.fromTable !== table.id && link.toTable !== table.id)
  selectedTable = null
  selectedColumn = null
  commit('add-table')
  notify('Table removed.')
}

function changeColumnFlag(field, key, value, table) {
  field[key] = value
  if (key === 'primary' && value) {
    for (const other of table.columns) {
      if (other !== field) other.primary = false
    }
    field.nullable = false
  }
  if (key === 'nullable' && value && field.default === 'identity') field.default = ''
  commit(`column-${key}`)
}

function columnEditor(table, field) {
  const editor = element('div', 'column-editor')
  const name = nameInput('column-name', 'Column name', field, table.columns, () => {
    const label = $(`field-${field.id}`).firstElementChild
    label.title = label.textContent = fieldName(field)
    for (const link of project.links.filter((link) => link.fromColumn === field.id || link.toColumn === field.id)) {
      const linkLabel = $(`link-${link.id}`)?.firstElementChild
      if (linkLabel) linkLabel.title = linkLabel.textContent = linkTitle(link)
    }
  })
  const type = element('select')
  type.id = 'column-type'
  setOptions(type, Object.entries(labels), field.type)
  type.addEventListener('change', () => {
    field.type = type.value
    if (!defaultsFor(field.type).includes(field.default)) field.default = ''
    commit('column-type')
  })
  const defaultValue = element('select')
  defaultValue.id = 'column-default'
  const defaults = defaultsFor(field.type).map((value) => [value, defaultLabels[value]])
  setOptions(defaultValue, defaults, field.default)
  defaultValue.disabled = defaults.length === 1
  defaultValue.addEventListener('change', () => {
    field.default = defaultValue.value
    if (field.default === 'identity') field.nullable = false
    commit('column-default')
  })
  const selectRow = element('div', 'form-grid')
  selectRow.append(fieldLabel('Type', type), fieldLabel('Default', defaultValue))

  const flags = element('div', 'column-options')
  for (const [key, label] of [['primary', 'Primary key'], ['unique', 'Unique'], ['nullable', 'Nullable']]) {
    const check = element('input')
    check.type = 'checkbox'
    check.id = `column-${key}`
    check.checked = field[key] || (key === 'unique' && field.primary)
    check.disabled = field.primary && key !== 'primary'
    check.addEventListener('change', () => changeColumnFlag(field, key, check.checked, table))
    const wrapper = element('label', 'check-label')
    wrapper.append(check, document.createTextNode(label))
    flags.append(wrapper)
  }
  const remove = button('Remove column', 'button danger small', () => {
    const links = project.links.filter((link) => link.fromColumn === field.id || link.toColumn === field.id)
    if (links.length && !window.confirm(`Remove ${fieldName(field)} and its relationships?`)) return
    table.columns = table.columns.filter((item) => item !== field)
    project.links = project.links.filter((link) => !links.includes(link))
    selectedColumn = null
    commit('table-name')
  })
  editor.append(name, selectRow, flags, remove)
  return editor
}

function linkTitle(link) {
  const { source, target, from, to } = endpoints(project, link)
  return `${tableName(source)}.${fieldName(from)} → ${tableName(target)}.${fieldName(to)}`
}

const sourceTable = $('source-table')
const sourceColumn = $('source-column')
const targetTable = $('target-table')
const targetColumn = $('target-column')
const deleteAction = $('delete-action')

function openLink(link = null) {
  editingLink = link
  $('relationship-title').textContent = link ? 'Edit relationship' : 'Add relationship'
  $('remove-link').hidden = !link
  const tables = project.tables.map((table) => [table.id, tableName(table)])
  setOptions(sourceTable, tables, link?.fromTable || selectedTable)
  refreshLinkFields(link)
  $('relationship-dialog').showModal()
}

function refreshLinkFields(preferred = {}) {
  const { fromColumn, toTable, toColumn, onDelete } = preferred || {}
  const source = tableById(sourceTable.value)
  const occupied = new Set(project.links.filter((link) => link !== editingLink).map((link) => link.fromColumn))
  const available = source?.columns.filter((field) => !occupied.has(field.id)) || []
  setOptions(sourceColumn, available.map((field) => [field.id, fieldName(field)]), fromColumn)
  const from = available.find((field) => field.id === sourceColumn.value)
  const targets = project.tables
    .map((table) => [table, table.columns.filter((field) => field.id !== from?.id && (field.primary || field.unique) && field.type === from?.type)])
    .filter(([, columns]) => columns.length > 0)
  setOptions(targetTable, targets.map(([table]) => [table.id, tableName(table)]), toTable)
  const columns = targets.find(([table]) => table.id === targetTable.value)?.[1] || []
  setOptions(targetColumn, columns.map((field) => [field.id, fieldName(field)]), toColumn)
  const availableActions = Object.keys(actions).filter((key) => key !== 'SetNull' || from?.nullable)
  setOptions(deleteAction, availableActions.map((key) => [key, actionLabels[key]]), onDelete)
  $('save-link').disabled = !from || !columns.length
  $('relationship-error').textContent = !from ? 'This table has no available foreign-key column.' : !columns.length ? 'Add a primary or unique column of the same type to use as a target.' : ''
  sourceColumn.disabled = !available.length
  targetTable.disabled = !targets.length
  targetColumn.disabled = !columns.length
  deleteAction.disabled = !columns.length
}

for (const select of [sourceTable, sourceColumn, targetTable]) {
  select.addEventListener('change', () => refreshLinkFields({
    fromColumn: sourceColumn.value, toTable: targetTable.value,
    toColumn: targetColumn.value, onDelete: deleteAction.value,
  }))
}

$('relationship-form').addEventListener('submit', (event) => {
  event.preventDefault()
  if ($('save-link').disabled) return
  const link = {
    id: editingLink?.id || newId(), fromTable: sourceTable.value, fromColumn: sourceColumn.value,
    toTable: targetTable.value, toColumn: targetColumn.value, onDelete: deleteAction.value,
  }
  if (editingLink) project.links[project.links.indexOf(editingLink)] = link
  else project.links.push(link)
  $('relationship-dialog').close()
  selectedTable = link.fromTable
  selectedColumn = link.fromColumn
  commit(`link-${link.id}`)
  notify(editingLink ? 'Relationship updated.' : 'Relationship added.')
})

$('remove-link').addEventListener('click', () => {
  if (!editingLink) return
  project.links = project.links.filter((link) => link !== editingLink)
  $('relationship-dialog').close()
  commit('add-link')
  notify('Relationship removed.')
})

function showValidation(issues) {
  $('validation-result').textContent = issues.length
    ? `${count(issues.length, 'issue')} to fix before export.`
    : 'Your schema is ready to export.'
  $('issues').replaceChildren(...issues.map((issue) => element('li', '', issue)))
  $('validation-dialog').showModal()
}

function previewExport() {
  const sql = $('format').value === 'sql'
  $('preview').value = sql ? exportSql(project) : exportPrisma(project)
  $('preview').scrollTop = 0
  $('format-help').textContent = sql ? 'Initial migration for an empty PostgreSQL schema.' : 'PostgreSQL datasource and models for Prisma ORM 7.'
  $('export-status').textContent = ''
}

$('validate').addEventListener('click', () => showValidation(validate(project)))
$('export').addEventListener('click', () => {
  const issues = validate(project)
  if (issues.length) showValidation(issues)
  else {
    previewExport()
    $('export-dialog').showModal()
  }
})
$('format').addEventListener('change', previewExport)
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('preview').value)
    if ($('export-dialog').open) $('export-status').textContent = 'Copied.'
  } catch {
    $('preview').focus()
    $('preview').select()
    $('export-status').textContent = 'Clipboard access was unavailable. The code is selected for copying.'
  }
})
$('download').addEventListener('click', () => {
  const href = URL.createObjectURL(new Blob([$('preview').value], { type: 'text/plain;charset=utf-8' }))
  const anchor = element('a')
  anchor.href = href
  anchor.download = $('format').value === 'sql' ? 'migration.sql' : 'schema.prisma'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
})
for (const close of document.querySelectorAll('dialog button.close')) {
  close.addEventListener('click', () => close.closest('dialog').close())
}

$('add-table').addEventListener('click', addTable)
$('empty-add').addEventListener('click', addTable)
$('add-link').addEventListener('click', () => openLink())
$('sample').addEventListener('click', () => {
  if (project.tables.length) return
  project = sampleProject()
  selectedTable = project.tables[0].id
  commit('table-name')
})
load()
updateDiagram()
renderInspector()

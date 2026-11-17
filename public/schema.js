export const types = {
  integer: ['integer', 'Int'],
  bigint: ['bigint', 'BigInt'],
  text: ['text', 'String'],
  boolean: ['boolean', 'Boolean'],
  uuid: ['uuid', 'String @db.Uuid'],
  timestamp: ['timestamptz(3)', 'DateTime @db.Timestamptz(3)'],
  decimal: ['numeric(18,6)', 'Decimal @db.Decimal(18, 6)'],
  json: ['jsonb', 'Json'],
}

export const actions = {
  Restrict: 'RESTRICT',
  Cascade: 'CASCADE',
  SetNull: 'SET NULL',
  NoAction: 'NO ACTION',
}

export const labels = {
  integer: 'Integer', bigint: 'Big integer', text: 'Text', boolean: 'Boolean',
  uuid: 'UUID', timestamp: 'Timestamp', decimal: 'Decimal', json: 'JSON',
}

export const limits = { tables: 80, columns: 60, links: 240, position: 6000, storage: 1_500_000 }
const namePattern = /^[A-Za-z][A-Za-z0-9_]{0,62}$/
const idPattern = /^[A-Za-z0-9_-]{1,64}$/
const has = (object, value) => Object.hasOwn(object, value)
const validRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isName = (value) => typeof value === 'string' && namePattern.test(value)
const isId = (value) => typeof value === 'string' && idPattern.test(value)
export const emptyProject = () => ({ tables: [], links: [] })
export const newId = () => crypto.randomUUID()
export const column = (name = 'id', type = 'integer', primary = false) => ({
  id: newId(), name, type, primary, unique: false, nullable: !primary, default: primary && type === 'integer' ? 'identity' : '',
})

export function defaultsFor(type) {
  if (type === 'integer' || type === 'bigint') return ['', 'identity']
  if (type === 'timestamp') return ['', 'now']
  if (type === 'uuid') return ['', 'uuid']
  return ['']
}

export function readProject(raw) {
  if (typeof raw !== 'string' || raw.length > limits.storage) throw new Error('Invalid project data.')
  const project = JSON.parse(raw)
  if (!hasProjectShape(project)) throw new Error('Invalid project data.')
  // Keep the stored format small and discard unknown properties.
  return {
    tables: project.tables.map(({ id, name, x, y, columns }) => ({
      id, name, x, y, columns: columns.map(({ id, name, type, primary, unique, nullable, default: value }) => ({
        id, name, type, primary, unique, nullable, default: value,
      })),
    })),
    links: project.links.map(({ id, fromTable, fromColumn, toTable, toColumn, onDelete }) => ({
      id, fromTable, fromColumn, toTable, toColumn, onDelete,
    })),
  }
}

function hasProjectShape(project) {
  if (!validRecord(project) || !Array.isArray(project.tables) || !Array.isArray(project.links)) return false
  if (project.tables.length > limits.tables || project.links.length > limits.links) return false
  const ids = new Set()
  const takeId = (id) => {
    if (!isId(id) || ids.has(id)) return false
    ids.add(id)
    return true
  }
  const position = (value) => Number.isFinite(value) && value >= 0 && value <= limits.position
  const draftName = (value) => typeof value === 'string' && value.length <= 63
  for (const table of project.tables) {
    if (!validRecord(table) || !takeId(table.id) || !draftName(table.name) || !position(table.x) || !position(table.y)) return false
    if (!Array.isArray(table.columns) || table.columns.length > limits.columns) return false
    for (const field of table.columns) {
      if (!validRecord(field) || !takeId(field.id) || !draftName(field.name)) return false
      if (typeof field.type !== 'string' || !has(types, field.type) || typeof field.default !== 'string' || field.default.length > 8) return false
      if (![field.primary, field.unique, field.nullable].every((flag) => typeof flag === 'boolean')) return false
    }
  }
  return project.links.every((link) => validRecord(link) && takeId(link.id)
    && [link.fromTable, link.fromColumn, link.toTable, link.toColumn].every(isId)
    && typeof link.onDelete === 'string' && has(actions, link.onDelete))
}

export function endpoints(project, link) {
  const source = project.tables.find((table) => table.id === link.fromTable)
  const target = project.tables.find((table) => table.id === link.toTable)
  return {
    source, target,
    from: source?.columns.find((field) => field.id === link.fromColumn),
    to: target?.columns.find((field) => field.id === link.toColumn),
  }
}

export function validate(project) {
  if (!hasProjectShape(project)) return ['The project contains invalid data.']
  if (!project.tables.length) return ['Add a table to validate your schema.']
  const issues = []
  const names = new Set()
  for (const [index, table] of project.tables.entries()) {
    const label = table.name || `Table ${index + 1}`
    if (!isName(table.name)) issues.push(`${label}: use a letter followed by letters, digits, or underscores for the table name.`)
    if (names.has(table.name)) issues.push(`${label}: duplicate table name.`)
    names.add(table.name)
    if (table.columns.filter((field) => field.primary).length !== 1) issues.push(`${label}: select one primary key.`)
    const fields = new Set()
    for (const field of table.columns) {
      const path = `${label}.${field.name || '(unnamed column)'}`
      if (!isName(field.name)) issues.push(`${path}: use a letter followed by letters, digits, or underscores for the column name.`)
      if (fields.has(field.name)) issues.push(`${path}: duplicate column name.`)
      if (systemColumns.has(field.name)) issues.push(`${path}: PostgreSQL reserves this column name.`)
      fields.add(field.name)
      if (field.primary && field.nullable) issues.push(`${path}: a primary key must be required.`)
      if (!defaultsFor(field.type).includes(field.default)) issues.push(`${path}: default does not match the column type.`)
      if (field.default === 'identity' && field.nullable) issues.push(`${path}: an identity column must be required.`)
    }
  }
  const used = new Set()
  for (const link of project.links) {
    const { source, from, to } = endpoints(project, link)
    if (!from || !to) {
      issues.push('A relationship references a missing table or column.')
      continue
    }
    const path = `${source.name}.${from.name}`
    if (used.has(from.id)) issues.push(`${path}: a column can have one foreign key.`)
    used.add(from.id)
    if (from.id === to.id) issues.push(`${path}: choose a different target column.`)
    if (!to.primary && !to.unique) issues.push(`${path}: the target column must be primary or unique.`)
    if (from.type !== to.type) issues.push(`${path}: foreign-key types must match.`)
    if (link.onDelete === 'SetNull' && !from.nullable) issues.push(`${path}: Set null requires a nullable foreign key.`)
  }
  return issues
}

const systemColumns = new Set(['tableoid', 'xmin', 'cmin', 'xmax', 'cmax', 'ctid'])
const sqlDefaults = { identity: ' GENERATED BY DEFAULT AS IDENTITY', now: ' DEFAULT CURRENT_TIMESTAMP', uuid: ' DEFAULT pg_catalog.gen_random_uuid()' }
const prismaDefaults = { identity: ' @default(autoincrement())', now: ' @default(now())', uuid: ' @default(dbgenerated("gen_random_uuid()"))' }
const quote = (value) => `"${value.replaceAll('"', '""')}"`

function allocate(base, used, max = 63) {
  let name = base.slice(0, max)
  for (let index = 2; used.has(name); index++) {
    const suffix = `_${index}`
    name = base.slice(0, max - suffix.length) + suffix
  }
  used.add(name)
  return name
}

function prepare(project) {
  const issues = validate(project)
  if (issues.length) throw new Error(issues[0])
  const names = new Set(project.tables.map((table) => table.name))
  // Identity sequence names are chosen by PostgreSQL. Create named constraints first so
  // later sequence allocation can see the complete constraint and table namespace.
  const keys = new Map()
  for (const table of project.tables) {
    for (const field of table.columns) {
      if (field.primary || field.unique) {
        const suffix = field.primary ? '_pkey' : '_key'
        const base = field.primary ? table.name : `${table.name}_${field.name}`
        keys.set(field.id, allocate(base.slice(0, 63 - suffix.length) + suffix, names))
      }
    }
  }
  const links = project.links.map((link) => {
    const values = endpoints(project, link)
    const base = `${values.source.name}_${values.from.name}`
    return { ...link, ...values, name: allocate(base.slice(0, 58) + '_fkey', names) }
  })
  return { keys, links }
}

export function exportSql(project) {
  const { keys, links } = prepare(project)
  const blocks = ['BEGIN;']
  const identities = []
  for (const table of project.tables) {
    const lines = table.columns.map((field) => {
      if (field.default === 'identity') identities.push(`ALTER TABLE ${quote(table.name)} ALTER COLUMN ${quote(field.name)} ADD${sqlDefaults.identity};`)
      const fallback = field.default && field.default !== 'identity' ? sqlDefaults[field.default] : ''
      const required = field.nullable ? '' : ' NOT NULL'
      const key = keys.has(field.id) ? ` CONSTRAINT ${quote(keys.get(field.id))} ${field.primary ? 'PRIMARY KEY' : 'UNIQUE'}` : ''
      return `  ${quote(field.name)} ${types[field.type][0]}${fallback}${required}${key}`
    })
    blocks.push(`CREATE TABLE ${quote(table.name)} (\n${lines.join(',\n')}\n);`)
  }
  for (const { source, target, from, to, name, onDelete } of links) {
    blocks.push(`ALTER TABLE ${quote(source.name)} ADD CONSTRAINT ${quote(name)}\n  FOREIGN KEY (${quote(from.name)}) REFERENCES ${quote(target.name)} (${quote(to.name)})\n  ON DELETE ${actions[onDelete]} ON UPDATE CASCADE;`)
  }
  if (identities.length) blocks.push(identities.join('\n'))
  blocks.push('COMMIT;')
  return blocks.join('\n\n') + '\n'
}

const prismaReserved = new Set([
  'Prisma', 'PrismaClient', 'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal',
  'DateTime', 'Json', 'Bytes', 'Unsupported', 'Null', 'True', 'False',
  'BatchPayload', 'QueryMode', 'TransactionClient', 'SortOrder', 'ModelName',
])

export function exportPrisma(project) {
  const { keys, links } = prepare(project)
  const models = new Map()
  const names = new Set(prismaReserved)
  const fields = new Map()
  for (const table of project.tables) {
    const base = table.name.split('_').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join('')
    models.set(table.id, allocate(base, names))
    fields.set(table.id, new Set(table.columns.map((field) => field.name)))
  }
  const blocks = ['datasource db {\n  provider = "postgresql"\n}']
  const relations = new Map(project.tables.map((table) => [table.id, []]))
  for (const { source, target, from, to, name, onDelete } of links) {
    const forward = allocate(`relation_${from.name}`, fields.get(source.id))
    const back = allocate(`related_${source.name}_${from.name}`, fields.get(target.id))
    const cardinality = from.primary || from.unique ? '?' : '[]'
    relations.get(source.id).push(`  ${forward} ${models.get(target.id)}${from.nullable ? '?' : ''} @relation(${quote(name)}, fields: [${from.name}], references: [${to.name}], onDelete: ${onDelete}, onUpdate: Cascade, map: ${quote(name)})`)
    relations.get(target.id).push(`  ${back} ${models.get(source.id)}${cardinality} @relation(${quote(name)})`)
  }
  for (const table of project.tables) {
    const lines = table.columns.map((field) => {
      const [type, native] = types[field.type][1].split(/ (.+)/)
      const key = keys.has(field.id) ? ` @${field.primary ? 'id' : 'unique'}(map: ${quote(keys.get(field.id))})` : ''
      const fallback = field.default ? prismaDefaults[field.default] : ''
      return `  ${field.name} ${type}${field.nullable ? '?' : ''}${key}${fallback}${native ? ` ${native}` : ''}`
    })
    blocks.push([
      `model ${models.get(table.id)} {`, ...lines, ...relations.get(table.id),
      `  @@map(${quote(table.name)})`, '}',
    ].join('\n'))
  }
  return blocks.join('\n\n') + '\n'
}

export function sampleProject() {
  const make = (name, x, y, columns) => ({ id: newId(), name, x, y, columns })
  const required = (name, type) => ({ ...column(name, type), nullable: false })
  const customers = make('customers', 64, 106, [
    column('id', 'integer', true), required('name', 'text'), { ...required('email', 'text'), unique: true },
  ])
  const orders = make('orders', 382, 190, [
    column('id', 'integer', true), required('customer_id', 'integer'),
    { ...required('placed_at', 'timestamp'), default: 'now' }, required('total', 'decimal'),
  ])
  const items = make('order_items', 700, 106, [
    column('id', 'integer', true), required('order_id', 'integer'), required('product', 'text'), required('quantity', 'integer'),
  ])
  const link = (source, target) => ({
    id: newId(), fromTable: source.id, fromColumn: source.columns[1].id,
    toTable: target.id, toColumn: target.columns[0].id, onDelete: 'Restrict',
  })
  return { tables: [customers, orders, items], links: [link(orders, customers), link(items, orders)] }
}

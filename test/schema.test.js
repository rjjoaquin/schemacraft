import assert from 'node:assert/strict'
import test from 'node:test'
import { column, exportPrisma, exportSql, newId, readProject, sampleProject, validate } from '../public/schema.js'

const table = (name, columns = [column('id', 'integer', true)]) => ({ id: newId(), name, x: 0, y: 0, columns })
const link = (source, from, target, to, onDelete = 'Restrict') => ({
  id: newId(), fromTable: source.id, fromColumn: from.id, toTable: target.id, toColumn: to.id, onDelete,
})

test('a fictional sample round trips and exports both formats', () => {
  const project = sampleProject()
  const restored = readProject(JSON.stringify(project))
  assert.deepEqual(restored, project)
  assert.deepEqual(validate(restored), [])
  assert.match(exportSql(restored), /FOREIGN KEY \("customer_id"\) REFERENCES "customers" \("id"\)/)
  assert.match(exportPrisma(restored), /model OrderItems \{/)
  assert.match(exportPrisma(restored), /related_orders_customer_id Orders\[\]/)
})

test('constraints and native types are represented in both exports', () => {
  const ref = { ...column('team_id', 'uuid'), unique: true }
  const user = table('users', [column('id', 'integer', true), ref])
  const teamId = { ...column('id', 'uuid', true), default: 'uuid' }
  const team = table('teams', [teamId])
  const project = { tables: [user, team], links: [link(user, ref, team, teamId, 'SetNull')] }
  const sql = exportSql(project)
  const prisma = exportPrisma(project)
  assert.match(sql, /uuid DEFAULT pg_catalog.gen_random_uuid\(\) NOT NULL/)
  assert.match(sql, /ON DELETE SET NULL ON UPDATE CASCADE/)
  assert.match(prisma, /team_id String\? @unique\(map: "users_team_id_key"\) @db.Uuid/)
  assert.match(prisma, /relation_team_id Teams\? @relation/)
  assert.match(prisma, /related_users_team_id Users\? @relation/)
  assert.match(prisma, /@default\(dbgenerated\("gen_random_uuid\(\)"\)\)/)
})

test('cyclic and self-referencing links follow table creation', () => {
  const a = table('a')
  const b = table('b')
  const toB = column('b_id', 'integer')
  const toA = column('a_id', 'integer')
  const parent = column('parent_id', 'integer')
  a.columns.push(toB, parent)
  b.columns.push(toA)
  const project = { tables: [a, b], links: [
    link(a, toB, b, b.columns[0]), link(b, toA, a, a.columns[0]), link(a, parent, a, a.columns[0]),
  ] }
  const sql = exportSql(project)
  assert.ok(sql.indexOf('CREATE TABLE "b"') < sql.indexOf('ADD CONSTRAINT'))
  assert.match(sql, /FOREIGN KEY \("parent_id"\) REFERENCES "a" \("id"\)/)
  assert.match(exportPrisma(project), /related_a_parent_id A\[\]/)
})

test('duplicate identifiers and absent primary keys block export', () => {
  const a = table('duplicate', [column('name', 'text'), column('name', 'text')])
  const project = { tables: [a, table('duplicate')], links: [] }
  assert.match(validate(project).join('\n'), /duplicate table name/)
  assert.match(validate(project).join('\n'), /duplicate column name/)
  assert.throws(() => exportPrisma(project), /select one primary key/)
})

test('foreign-key checks prevent type mismatches, invalid targets, and Set null on required columns', () => {
  const source = table('source')
  const invalid = column('freeform', 'text')
  const target = table('target', [column('id', 'integer', true), invalid])
  const project = { tables: [source, target], links: [link(source, source.columns[0], target, invalid, 'SetNull')] }
  assert.deepEqual(validate(project), [
    'source.id: the target column must be primary or unique.',
    'source.id: foreign-key types must match.',
    'source.id: Set null requires a nullable foreign key.',
  ])
})

test('deleted endpoints and duplicate source keys fail validation', () => {
  const target = table('target')
  const source = table('source')
  const fk = link(source, source.columns[0], target, target.columns[0])
  const project = { tables: [source, target], links: [fk, { ...fk, id: newId() }] }
  assert.match(validate(project).join('\n'), /a column can have one foreign key/)
  project.tables.pop()
  assert.match(validate(project).join('\n'), /missing table or column/)
})

test('generated names stay distinct when truncated or occupied by tables', () => {
  const long = 'a'.repeat(60)
  const a = table(long + 'abc')
  const b = table(long + 'def')
  const c = table(long.slice(0, 58) + '_pkey')
  const project = { tables: [a, b, c], links: [] }
  const names = [...exportSql(project).matchAll(/CONSTRAINT "([^"]+)"/g)].map((match) => match[1])
  assert.equal(new Set(names).size, 3)
  assert.ok(names.every((name) => name.length <= 63 && name !== c.name))
})

test('Prisma model names are disambiguated while SQL identifiers keep their original case', () => {
  const project = { tables: [table('a_b'), table('AB'), table('int'), table('select')], links: [] }
  const prisma = exportPrisma(project)
  assert.match(prisma, /model AB \{/)
  assert.match(prisma, /model AB_2 \{/)
  assert.match(prisma, /model Int_2 \{/)
  assert.match(exportSql(project), /CREATE TABLE "select"/)
})

test('SQL and Prisma injection payloads are rejected before generation', () => {
  const project = { tables: [table('x");DROP TABLE data;--')], links: [] }
  assert.throws(() => exportSql(project), /use a letter/)
  assert.throws(() => exportPrisma(project), /use a letter/)
  project.tables[0].name = 'valid'
  project.tables[0].columns[0].default = 'evil'
  assert.throws(() => exportSql(project), /default does not match/)
})

test('stored data rejects oversized and malformed records and ignores extra keys', () => {
  const project = sampleProject()
  project.extra = { personalData: 'discarded fixture' }
  assert.equal(Object.hasOwn(readProject(JSON.stringify(project)), 'extra'), false)
  assert.throws(() => readProject('x'.repeat(1_500_001)), /invalid project data/i)
  project.tables[0].columns[0].type = '__proto__'
  assert.throws(() => readProject(JSON.stringify(project)), /invalid project data/i)
  project.tables[0].columns[0].type = 'integer'
  project.links[0].id = project.tables[0].id
  assert.throws(() => readProject(JSON.stringify(project)), /invalid project data/i)
})

# SchemaCraft

Design a PostgreSQL schema on a drag-and-drop diagram. Add tables and columns, connect foreign keys, then validate and export `migration.sql` or `schema.prisma`.

## Run locally

With Node.js 22 or later, run `npm run dev` and open [localhost:4173](http://localhost:4173). Run `npm test` for the offline checks. No dependencies to install.

Projects autosave in the current browser. **Load sample** adds a fictional store schema with no row data.

## Exports

- **SQL** creates tables and constraints in an empty PostgreSQL 13+ schema. Each table has one primary-key column. Use a join table for many-to-many relationships.
- **Prisma** exports the PostgreSQL datasource and mapped models for Prisma ORM 7. Set the database URL in your Prisma config and add your client generator if needed.

## Deploy

Publish `public/` on a static host over HTTPS. On Netlify, use `public` as the publish directory with no build command. Use a dedicated origin because project drafts are stored by origin.

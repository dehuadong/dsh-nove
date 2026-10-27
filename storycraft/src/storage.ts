/**
 * Public storage surface for the studio.
 *
 * The work store is SQLite: `store-db.js` owns every read and write, `db.js`
 * owns the two schemas and connection policy, and `domain.js` owns the shared
 * vocabulary. This module is the stable facade the actions, routes and skills
 * import, so callers never depend on which module owns a query.
 *
 * Every returned path is a virtual `works/<workId>/...` path: work content lives
 * in `.storycraft/works/<workId>.db`, not in files on disk.
 */

export * from './domain.ts'
export * from './store-db.ts'

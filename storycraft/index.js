/**
 * Host half of the Storycraft bundle.
 *
 * Read-only surfaces, loopback-only and side-effect free:
 *
 *  - the workbench reads (`works`, `work`, `chapter`, `review`, `state`) over
 *    files the long-form actions wrote;
 *  - the diagnostics (`roster`, `document`) that report the live preset roster
 *    and one preset's declared composition.
 *
 * Nothing here writes; every mutation is an action the model calls.
 */

import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { approveChapterPlan, approveFoundation, approveOutline, createBackup, deleteBackup, deleteChapter, deleteMaterial, ensureReconciled, exportWorkAtomic, importMaterial, moveChapter, listMaterials, listTrash, listWorks, nextStep, purgeTrash, readFoundationState, readManifest, restoreBackup, listBackups, readChapter, readReview, readWork, renameMaterial, restoreWork, setMaterialPurpose, status as readStatus, StoryError } from './storage.js'
import { critique } from './dist/critique.js'
import { clearCurrent, getCurrent, hydrate as hydrateCurrent, setCurrent } from './dist/current.js'
import { readVolumes } from './volumes.js'
import { clearSessionCurrent, readSessionCurrent, setSessionCurrent } from './store-db.js'
import { assembleBrief, extractStyleSamples, readBible, writeBible } from './bible.js'
import { listRoleCards, readFoundationDocuments, renderFoundationContent } from './artifact-store.js'
import { backupsDir, exportsDir } from './dist/db.js'

/** Requires the host web server; without it the browser surface has no data. */
export const inject = ['webServer']

/** Route prefix owned by this plugin. */
const BASE = '/api/dsh-storycraft'

/**
 * Answer one request with JSON.
 * @param {object} res - ServerResponse.
 * @param {number} status - HTTP status.
 * @param {unknown} body - serializable payload.
 */
function json(res, code, body) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * Whether the request came from this machine over loopback.
 * @param {object} req - IncomingMessage.
 * @returns {boolean} true for a loopback peer.
 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** The single failure envelope every route answers with. */
function failure(code, message) {
  return { ok: false, error: { code, message } }
}

/**
 * Guard a read route and answer with one envelope shape.
 * @param {object} req - IncomingMessage.
 * @param {object} res - ServerResponse.
 * @param {(query: URLSearchParams) => Promise<object>} handler - route body returning the success payload.
 */
async function readRoute(req, res, handler) {
  if (req.method !== 'GET') {
    json(res, 405, failure('method-not-allowed', '请使用 GET。'))
    return
  }
  if (!isLoopback(req)) {
    json(res, 403, failure('loopback-only', '该接口只允许本机访问。'))
    return
  }
  try {
    const query = new URL(req.url ?? '/', 'http://dsh.invalid').searchParams
    json(res, 200, { ok: true, ...(await handler(query)) })
  } catch (error) {
    if (error instanceof StoryError) {
      json(res, 200, failure(error.code, error.message))
      return
    }
    json(res, 500, failure('internal', error instanceof Error ? error.message : String(error)))
  }
}

/**
 * Guard a write route that reads a small JSON body.
 * @param {object} req - IncomingMessage.
 * @param {object} res - ServerResponse.
 * @param {(body: object) => Promise<object>} handler - route body returning the success payload.
 */
async function postRoute(req, res, handler, options = {}) {
  if (req.method !== 'POST') {
    json(res, 405, failure('method-not-allowed', '请使用 POST。'))
    return
  }
  if (!isLoopback(req)) {
    json(res, 403, failure('loopback-only', '该接口只允许本机访问。'))
    return
  }
  try {
    if (options.requireJson === true
      && !String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      throw new StoryError('invalid-body', '请求必须是 application/json')
    }
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (Number.isInteger(options.maxBytes) && size > options.maxBytes) {
        throw new StoryError('body-too-large', '请求体超过上限')
      }
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    let body
    try {
      body = text === '' ? {} : JSON.parse(text)
    } catch {
      throw new StoryError('invalid-body', '请求体不是合法 JSON')
    }
    json(res, 200, { ok: true, ...(await handler(body)) })
  } catch (error) {
    if (error instanceof StoryError) {
      json(res, 200, failure(error.code, error.message))
      return
    }
    json(res, 500, failure('internal', error instanceof Error ? error.message : String(error)))
  }
}

/**
 * Read the persisted session → work pointers of one workspace.
 * @param {string} root - workspace directory.
 * @returns {Promise<Record<string, string>>} the map, empty when absent.
 */
async function readCurrentFile(root) {
  try {
    return readSessionCurrent(root)
  } catch {
    return {}
  }
}


/**
 * Whether a directory is one of the deployment's workspaces.
 *
 * The browser names the workspace it shows; the host only agrees for a
 * directory its own registry knows, so a crafted request cannot turn these
 * routes into an arbitrary-tree reader.
 * @param {object} ctx - host plugin context.
 * @param {string} root - requested workspace directory.
 * @returns {boolean} true when the path is a known workspace, or when this
 *   deployment composes no registry to check against.
 */
async function workspaceRootOf(ctx, root) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') {
    throw new StoryError('workspace-registry-unavailable', '宿主没有工作区注册表，无法校验作品根')
  }
  const canonical = async (value) => {
    try {
      return await realpath(resolve(value))
    } catch {
      return resolve(value)
    }
  }
  const wanted = await canonical(root)
  const normalize = value => value.replace(/\\/g, '/').toLowerCase()
  const known = await Promise.all((registry.list() ?? []).map(workspace => canonical(workspace.path)))
  if (!known.some(path => normalize(path) === normalize(wanted))) {
    throw new StoryError('unknown-workspace', `宿主不认识这个工作区目录：${root}`)
  }
  return wanted
}

/**
 * The workspace root a read names.
 * @param {object} ctx - host plugin context.
 * @param {URLSearchParams} query - request query.
 * @returns {string} absolute workspace directory.
 */
async function rootOf(ctx, query) {
  const root = query.get('root') ?? ''
  if (root === '' || !isAbsolute(root)) {
    throw new StoryError('invalid-root', '缺少绝对路径参数 root（当前工作区目录）')
  }
  return await workspaceRootOf(ctx, root)
}

/** The work identity a read names. */
function workOf(query) {
  const id = query.get('id') ?? ''
  if (id === '') throw new StoryError('invalid-work', '缺少参数 id（作品 id）')
  return id
}

/** The chapter number a read names. */
function chapterOf(query) {
  const chapter = Number(query.get('chapter') ?? '')
  if (!Number.isInteger(chapter) || chapter < 1) throw new StoryError('invalid-chapter', '缺少参数 chapter（章号）')
  return chapter
}

/**
 * Register the read-only routes.
 * @param {object} ctx - host plugin context (service: webServer).
 */
export function apply(ctx) {
  // Reconcile the catalog against the files at startup, for every workspace the
  // host already knows. A workspace registered later is reconciled on first use.
  try {
    const registry = ctx.get('workspaceRegistry')
    for (const workspace of registry?.list?.() ?? []) {
      if (typeof workspace?.path === 'string') ensureReconciled(workspace.path)
    }
  } catch {
    // Reconciliation is diagnostic; it never blocks the host surfaces.
  }
  const writeWorkTarget = async (body) => {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    const workId = typeof body?.workId === 'string' ? body.workId : ''
    if (sessionId === '' || workId === '') throw new StoryError('invalid-body', '操作需要 sessionId 与 workId')
    const root = await rootOf(ctx, new URLSearchParams({ root: String(body?.root ?? '') }))
    await readManifest(root, workId)
    if (getCurrent(sessionId) !== workId) {
      hydrateCurrent(await readCurrentFile(root))
      if (getCurrent(sessionId) !== workId) {
        throw new StoryError('work-mismatch', '只在面板当前作品里操作')
      }
    }
    return { root, workId }
  }
  const targetWork = async (body) => {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    const workId = typeof body?.workId === 'string' ? body.workId : ''
    if (sessionId === '' || workId === '') throw new StoryError('invalid-body', '操作需要 sessionId 与 workId')
    const root = await rootOf(ctx, new URLSearchParams({ root: String(body?.root ?? '') }))
    const works = await listWorks(root)
    if (!works.some(work => work.workId === workId)) throw new StoryError('work-not-found', `没有作品：${workId}`)
    if (getCurrent(sessionId) !== workId) {
      hydrateCurrent(await readCurrentFile(root))
      if (getCurrent(sessionId) !== workId) throw new StoryError('work-mismatch', '只在面板当前作品里操作')
    }
    return { root, workId }
  }
  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/works`,
      handler: (req, res) => readRoute(req, res, async (query) => {
        const root = await rootOf(ctx, query)
        return { root, works: await listWorks(root) }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/trash`,
      handler: (req, res) => readRoute(req, res, async (query) => ({
        items: await listTrash(await rootOf(ctx, query)),
      })),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/trash/restore`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const root = await rootOf(ctx, new URLSearchParams({ root: String(body?.root ?? '') }))
          if (typeof body?.workId !== 'string') throw new StoryError('invalid-body', '恢复需要 workId')
          return restoreWork(root, { name: body.workId })
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/trash/purge`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          if (body?.confirm !== true) throw new StoryError('delete-unconfirmed', '彻底删除需要确认')
          const root = await rootOf(ctx, new URLSearchParams({ root: String(body?.root ?? '') }))
          if (typeof body?.workId !== 'string') throw new StoryError('invalid-body', '彻底删除需要 workId')
          return purgeTrash(root, { work: body.workId })
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/backups/create`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await targetWork(body)
          return createBackup(root, workId, body?.keep === undefined ? 10 : Number(body.keep))
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/backups/restore`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await targetWork(body)
          if (body?.confirm !== true) throw new StoryError('backup-restore-unconfirmed', '恢复备份需要确认')
          return restoreBackup(root, workId, String(body?.backupId ?? ''))
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/backups/delete`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await targetWork(body)
          if (body?.confirm !== true) throw new StoryError('backup-delete-unconfirmed', '删除备份需要确认')
          return deleteBackup(root, workId, String(body?.backupId ?? ''))
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/current`,
      handler: (req, res) => {
        if (req.method === 'POST') {
          void postRoute(req, res, async (body) => {
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
            if (sessionId === '') throw new StoryError('session-required', '缺少 sessionId')
            const workId = typeof body?.workId === 'string' ? body.workId : ''
            const root = await rootOf(ctx, new URLSearchParams({ root: String(body?.root ?? '') }))
            if (workId === '') {
              clearCurrent(sessionId)
              clearSessionCurrent(root, sessionId)
              return { current: undefined }
            }
            const manifest = await readManifest(root, workId)
            setCurrent(sessionId, manifest.workId)
            setSessionCurrent(root, sessionId, manifest.workId)
            return { current: manifest.workId }
          })
          return
        }
        void readRoute(req, res, async (query) => {
          const sessionId = query.get('sessionId') ?? undefined
          const root = query.get('root')
          if (getCurrent(sessionId) === undefined && root !== null && root !== '') {
            hydrateCurrent(await readCurrentFile(await rootOf(ctx, query)))
          }
          return { current: getCurrent(sessionId) }
        })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/foundation`,
      handler: (req, res) => readRoute(req, res, async (query) => {
        const root = await rootOf(ctx, query)
        const workId = typeof query.get('id') === 'string' ? query.get('id') : ''
        if (workId === '') throw new StoryError('invalid-query', '读取基础设定需要 id')
        const foundation = readFoundationState(root, workId)
        const documents = readFoundationDocuments(root, workId)
        return {
          workId,
          foundation,
          documents: [
            ['story_frame', documents.storyFrame],
            ['volume_map', documents.volumeMap],
            ['book_rules', documents.bookRules],
            ['roles_index', documents.rolesIndex],
            ['current_focus', documents.currentFocus],
          ].filter(([, entry]) => entry !== undefined).map(([name, entry]) => ({
            name,
            revisionId: entry.version,
            content: renderFoundationContent(entry.content),
          })).concat(listRoleCards(root, workId).map(card => ({
            name: card.artifactId.slice('role:'.length),
            revisionId: card.revisionId,
            content: renderFoundationContent(card.content),
          }))),
        }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/foundation/approve`,
      handler: (req, res) => {
        if (req.method !== 'POST') {
          void readRoute(req, res, async () => {
            throw new StoryError('method-not-allowed', '确认基础设定只接受 POST')
          })
          return
        }
        void postRoute(req, res, async (body) => {
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
          const workId = typeof body?.workId === 'string' ? body.workId : ''
          if (sessionId === '' || workId === '') {
            throw new StoryError('invalid-body', '确认基础设定需要 sessionId 与 workId')
          }
          const root = await rootOf(ctx, new URLSearchParams({ root: String(body?.root ?? '') }))
          if (getCurrent(sessionId) !== workId) {
            throw new StoryError('work-mismatch', '只在面板当前作品里确认基础设定')
          }
          const approved = approveFoundation(root, { work: workId })
          return { workId, foundation: approved.foundation }
        })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/outline/approve`,
      handler: (req, res) => {
        if (req.method !== 'POST') {
          void readRoute(req, res, async () => {
            throw new StoryError('method-not-allowed', '确认全书计划只接受 POST')
          })
          return
        }
        void postRoute(req, res, async (body) => {
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
          const workId = typeof body?.workId === 'string' ? body.workId : ''
          if (sessionId === '' || workId === '') {
            throw new StoryError('invalid-body', '确认全书计划需要 sessionId 与 workId')
          }
          const root = await rootOf(ctx, new URLSearchParams({ root: String(body?.root ?? '') }))
          if (getCurrent(sessionId) !== workId) {
            throw new StoryError('work-mismatch', '只在面板当前作品里确认全书计划')
          }
          const approved = await approveOutline(root, { work: workId })
          return { workId, outline: approved.outline }
        })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/chapter/approve`,
      handler: (req, res) => {
        if (req.method !== 'POST') {
          void readRoute(req, res, async () => {
            throw new StoryError('method-not-allowed', '确认章纲只接受 POST')
          })
          return
        }
        void postRoute(req, res, async (body) => {
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
          const workId = typeof body?.workId === 'string' ? body.workId : ''
          if (sessionId === '' || workId === '') {
            throw new StoryError('invalid-body', '确认章纲需要 sessionId 与 workId')
          }
          const root = await rootOf(ctx, new URLSearchParams({ root: String(body?.root ?? '') }))
          if (getCurrent(sessionId) !== workId) {
            throw new StoryError('work-mismatch', '只在面板当前作品里确认章纲')
          }
          const approved = await approveChapterPlan(root, { work: workId, chapter: body?.chapter })
          return { workId, chapter: approved.entry.number, planApprovedAt: approved.entry.planApprovedAt }
        })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/style/extract`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await writeWorkTarget(body)
          return extractStyleSamples(root, workId)
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/chapter/delete`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await writeWorkTarget(body)
          return deleteChapter(root, workId, Number(body?.chapter), { confirm: body?.confirm === true })
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/chapter/move`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await writeWorkTarget(body)
          return moveChapter(root, workId, Number(body?.from), Number(body?.to))
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/next`,
      handler: (req, res) => readRoute(req, res, async (query) => ({
        next: await nextStep(await rootOf(ctx, query), workOf(query)),
      })),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/critique`,
      handler: (req, res) => readRoute(req, res, async (query) => {
        const root = await rootOf(ctx, query)
        const work = workOf(query)
        const manifest = await readManifest(root, work)
        const chapter = await readChapter(root, { work, chapter: chapterOf(query) })
        return { metrics: critique(chapter.content, manifest.wordRange) }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/volumes`,
      handler: (req, res) => readRoute(req, res, async (query) => ({
        volumes: await readVolumes(await rootOf(ctx, query), workOf(query)),
      })),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/materials`,
      handler: (req, res) => readRoute(req, res, async (query) => {
        const root = await rootOf(ctx, query)
        const workId = query.get('workId') ?? workOf(query)
        const purpose = query.get('purpose') ?? undefined
        return { materials: await listMaterials(root, workId, purpose) }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/materials/import`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await writeWorkTarget(body)
          const name = typeof body?.name === 'string' ? body.name : ''
          const contentBase64 = typeof body?.contentBase64 === 'string' ? body.contentBase64 : ''
          return importMaterial(root, workId, {
            name,
            contentBase64,
            ...(typeof body?.title === 'string' ? { title: body.title } : {}),
            ...(body?.purpose === undefined ? {} : { purpose: body.purpose }),
          })
        }, { maxBytes: 1024 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/materials/rename`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await writeWorkTarget(body)
          const material = await renameMaterial(root, workId, String(body?.id ?? ''), String(body?.title ?? ''))
          return { material }
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/materials/purpose`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await writeWorkTarget(body)
          const material = await setMaterialPurpose(root, workId, String(body?.id ?? ''), String(body?.purpose ?? ''))
          return { material }
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/materials/delete`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await writeWorkTarget(body)
          return deleteMaterial(root, workId, String(body?.id ?? ''))
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/export`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await writeWorkTarget(body)
          return exportWorkAtomic(root, workId)
        }, { maxBytes: 32 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/exports`,
      handler: (req, res) => readRoute(req, res, async (query) => {
        const root = await rootOf(ctx, query)
        const workId = workOf(query)
        const directory = join(exportsDir(root), workId)
        const info = await stat(directory).catch(() => undefined)
        return { exportId: `export:${workId}`, directory, exists: info?.isDirectory() === true }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/backups`,
      handler: (req, res) => readRoute(req, res, async (query) => {
        const root = await rootOf(ctx, query)
        const workId = workOf(query)
        return { backups: listBackups(root, workId) }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/work`,
      handler: (req, res) => readRoute(req, res, async (query) => readWork(await rootOf(ctx, query), workOf(query))),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/chapter`,
      handler: (req, res) => readRoute(req, res, async (query) => {
        const root = await rootOf(ctx, query)
        const requested = query.get('view')
        const view = requested === 'plan' || requested === 'summary' ? requested : 'body'
        const revision = Number(query.get('revision') ?? '0')
        const chapter = await readChapter(root, {
          work: workOf(query),
          chapter: chapterOf(query),
          view,
          ...(Number.isInteger(revision) && revision > 0 ? { revision } : {}),
        })
        return { view, ...chapter }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/review`,
      handler: (req, res) => readRoute(req, res, async (query) =>
        readReview(await rootOf(ctx, query), workOf(query), chapterOf(query))),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/state`,
      handler: (req, res) => readRoute(req, res, async (query) => ({
        state: readStatus(await rootOf(ctx, query), workOf(query)),
      })),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/bible`,
      handler: (req, res) => readRoute(req, res, async (query) => {
        const root = await rootOf(ctx, query)
        const file = query.get('file') ?? undefined
        return { ...(await readBible(root, workOf(query), file === null ? undefined : file)) }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/bible/write`,
      handler: (req, res) => {
        void postRoute(req, res, async (body) => {
          const { root, workId } = await writeWorkTarget(body)
          if (typeof body?.file !== 'string' || typeof body?.content !== 'string') {
            throw new StoryError('invalid-body', '写入真值需要 file 与 content')
          }
          const expectedVersion = typeof body?.expectedVersion === 'string' ? body.expectedVersion : undefined
          const written = await writeBible(root, workId, body.file, body.content, { expectedVersion })
          return { name: written.name, path: written.path, version: written.version }
        }, { maxBytes: 64 * 1024, requireJson: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/brief`,
      handler: (req, res) => readRoute(req, res, async (query) => ({
        ...(await assembleBrief(await rootOf(ctx, query), workOf(query), chapterOf(query))),
      })),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/roster`,
      handler: (req, res) => readRoute(req, res, async () => {
        const registry = ctx.get('agentPresets')
        if (registry === undefined || typeof registry.list !== 'function') return { available: false, presets: [] }
        const presets = await registry.list()
        return {
          available: true,
          presets: (presets ?? []).map(preset => ({
            id: preset.id,
            name: preset.name ?? null,
            description: preset.description ?? null,
            isDefault: preset.isDefault === true,
            broken: typeof preset.broken === 'string' ? preset.broken : null,
          })),
        }
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/document`,
      handler: (req, res) => readRoute(req, res, async (query) => {
        const id = query.get('id') ?? ''
        if (id === '') throw new StoryError('missing-id', '缺少 id 参数。')
        const registry = ctx.get('agentPresets')
        if (registry === undefined || typeof registry.readDocument !== 'function') return { available: false }
        const document = await registry.readDocument(id)
        return {
          available: true,
          agentPreset: document?.agentPreset ?? id,
          content: String(document?.content ?? ''),
        }
      }),
    }),
  ]
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'dsh-storycraft: read-only routes')
}

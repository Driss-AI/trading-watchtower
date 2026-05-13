import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { Octokit } from '@octokit/rest'
import { randomUUID } from 'crypto'

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN
const GITHUB_REPO   = process.env.GITHUB_REPO   ?? 'trading-watchtower'
const GITHUB_OWNER  = process.env.GITHUB_OWNER  ?? 'Driss-AI'
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? 'main'

function buildServer() {
  const octokit = new Octokit({ auth: GITHUB_TOKEN || undefined })
  const server = new McpServer({ name: 'watchtower-github-mcp', version: '1.0.3' })

  server.tool(
    'list_directory',
    'List files and subdirectories at a given path in the repository.',
    {
      path:  z.string().optional().default('').describe('Directory path, e.g. "components" or "" for root'),
      owner: z.string().optional().default(GITHUB_OWNER).describe('Repo owner'),
      repo:  z.string().optional().default(GITHUB_REPO).describe('Repo name'),
      ref:   z.string().optional().default(GITHUB_BRANCH).describe('Branch, tag, or commit SHA'),
    },
    async ({ path, owner, repo, ref }) => {
      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path, ref })
        const entries = Array.isArray(data) ? data : [data]
        const list = entries.map((e: any) => ({
          name: e.name,
          type: e.type,
          size: e.size ?? 0,
          path: e.path,
        }))
        return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error listing ${path}: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'get_file',
    'Read the contents of a file from the GitHub repository.',
    {
      path:  z.string().describe('File path relative to repo root, e.g. "lib/topstepx-ws.ts"'),
      owner: z.string().optional().default(GITHUB_OWNER).describe('Repo owner'),
      repo:  z.string().optional().default(GITHUB_REPO).describe('Repo name'),
      ref:   z.string().optional().default(GITHUB_BRANCH).describe('Branch, tag, or commit SHA'),
    },
    async ({ path, owner, repo, ref }) => {
      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path, ref })
        if (Array.isArray(data)) {
          return { content: [{ type: 'text' as const, text: `${path} is a directory. Use list_directory instead.` }], isError: true }
        }
        const content = Buffer.from((data as any).content, 'base64').toString('utf-8')
        return {
          content: [{
            type: 'text' as const,
            text: content,
          }],
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error reading ${path}: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'get_tree',
    'Get the full recursive file tree of the repository.',
    {
      owner: z.string().optional().default(GITHUB_OWNER).describe('Repo owner'),
      repo:  z.string().optional().default(GITHUB_REPO).describe('Repo name'),
      ref:   z.string().optional().default(GITHUB_BRANCH).describe('Branch, tag, or commit SHA'),
    },
    async ({ owner, repo, ref }) => {
      try {
        const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${ref}` })
        const sha = refData.object.sha
        const { data } = await octokit.git.getTree({ owner, repo, tree_sha: sha, recursive: '1' })
        return { content: [{ type: 'text' as const, text: JSON.stringify(data.tree, null, 2) }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error getting tree: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'search_code',
    'Search for code patterns in the repository using GitHub code search.',
    {
      query: z.string().min(2).describe('Code search query'),
      owner: z.string().optional().default(GITHUB_OWNER).describe('Repo owner'),
      repo:  z.string().optional().default(GITHUB_REPO).describe('Repo name'),
    },
    async ({ query, owner, repo }) => {
      try {
        const { data } = await octokit.search.code({ q: `${query} repo:${owner}/${repo}` })
        const results = data.items.map((i: any) => ({ path: i.path, url: i.html_url }))
        return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error searching: ${err.message}` }], isError: true }
      }
    }
  )

  return server
}

// ── Session management ──────────────────────────────────────────────
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; lastAccess: number }>()
const SESSION_TTL = 30 * 60 * 1000 // 30 minutes

// Clean up stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      try { session.transport.close() } catch {}
      try { session.server.close() } catch {}
      sessions.delete(id)
      console.log(`Session expired: ${id} (remaining: ${sessions.size})`)
    }
  }
}, 5 * 60 * 1000)

async function main() {
  if (!GITHUB_TOKEN) {
    console.warn('WARNING: GITHUB_TOKEN not set — only public repos will be accessible')
  }

  const app = express()
  app.use(express.json())

  console.log(`   MCP endpoint: POST /mcp`)
  console.log(`   Health check: GET /health`)
  console.log(`   Repo: ${GITHUB_OWNER}/${GITHUB_REPO} (branch: ${GITHUB_BRANCH})`)
  console.log(`   Token: ${GITHUB_TOKEN ? 'set' : 'NOT SET'}`)

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '1.0.3',
      repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
      hasToken: !!GITHUB_TOKEN,
      sessions: sessions.size,
    })
  })

  // ── MCP endpoint ──────────────────────────────────────────────────
  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    // ── Existing session: reuse transport ────────────────────────────
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!
      session.lastAccess = Date.now()
      try {
        await session.transport.handleRequest(req, res, req.body)
      } catch (err) {
        console.error(`Session ${sessionId} handleRequest error:`, err)
        if (!res.headersSent) res.status(500).json({ error: 'Internal error' })
      }
      return
    }

    // ── Stale session ID: strip it so the new transport doesn't reject ─
    if (sessionId) {
      console.log(`Stale session ${sessionId} — creating fresh session`)
      delete req.headers['mcp-session-id']
    }

    // ── New session ─────────────────────────────────────────────────
    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id: string) => {
        sessions.set(id, { transport, server, lastAccess: Date.now() })
        console.log(`Session created: ${id} (total: ${sessions.size})`)
      },
    })

    await server.connect(transport)

    try {
      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      console.error('New session handleRequest error:', err)
      if (!res.headersSent) res.status(500).json({ error: 'Failed to initialize session' })
    }
  })

  app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use POST.' })
  })

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!
      sessions.delete(sessionId)
      try { session.transport.close() } catch {}
      try { session.server.close() } catch {}
      res.json({ message: 'Session closed' })
      console.log(`Session closed: ${sessionId} (total: ${sessions.size})`)
    } else {
      res.status(404).json({ error: 'Session not found' })
    }
  })

  const port = parseInt(process.env.PORT ?? '8080', 10)
  app.listen(port, () => {
    console.log(`\nwatchtower-github-mcp v1.0.3 running on port ${port}`)
  })
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})

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
  const octokit = new Octokit({ auth: GITHUB_TOKEN })
  const server = new McpServer({ name: 'watchtower-github-mcp', version: '1.0.0' })

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
        const list = entries.map(e => ({
          name: e.name,
          type: e.type,
          size: e.size ?? 0,
          path: e.path,
        }))
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error listing ${path}: ${err.message}` }], isError: true }
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
          return { content: [{ type: 'text', text: `${path} is a directory. Use list_directory instead.` }], isError: true }
        }
        const content = Buffer.from(data.content, 'base64').toString('utf-8')
        return { content: [{ type: 'text', text: content }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error reading ${path}: ${err.message}` }], isError: true }
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
        return { content: [{ type: 'text', text: JSON.stringify(data.tree, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error getting tree: ${err.message}` }], isError: true }
      }
    }
  )

  server.tool(
    'search_code',
    'Search for code patterns in the repository.',
    {
      query: z.string().describe('Search query'),
      owner: z.string().optional().default(GITHUB_OWNER).describe('Repo owner'),
      repo:  z.string().optional().default(GITHUB_REPO).describe('Repo name'),
    },
    async ({ query, owner, repo }) => {
      try {
        const { data } = await octokit.search.code({ q: `${query} repo:${owner}/${repo}` })
        const results = data.items.map(i => ({ path: i.path, url: i.html_url }))
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error searching: ${err.message}` }], isError: true }
      }
    }
  )

  return server
}

// Session store - keeps transport+server alive between HTTP requests
const sessions = new Map()
const SESSION_TTL = 30 * 60 * 1000 // 30 minutes

// Clean up stale sessions every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      try { session.transport.close() } catch {}
      try { session.server.close() } catch {}
      sessions.delete(id)
    }
  }
}, 5 * 60 * 1000)

async function main() {
  if (!GITHUB_TOKEN) {
    console.error('WARNING: GITHUB_TOKEN env var is not set')
  }

  const app = express()
  app.use(express.json())

  console.log(`   MCP endpoint: POST /mcp`)
  console.log(`   Health check: GET /health`)
  console.log(`   Repo: ${GITHUB_OWNER}/${GITHUB_REPO} (branch: ${GITHUB_BRANCH})`)

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', repo: `${GITHUB_OWNER}/${GITHUB_REPO}`, hasToken: !!GITHUB_TOKEN, sessions: sessions.size })
  })

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id']

    // Existing session - reuse transport
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)
      session.lastAccess = Date.now()
      await session.transport.handleRequest(req, res, req.body)
      return
    }

    // New session (initialize request - no session ID header)
    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server, lastAccess: Date.now() })
        console.log(`Session created: ${id} (total: ${sessions.size})`)
      },
    })

    // DO NOT clean up on res.close - session must persist for subsequent requests!
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use POST.' })
  })

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id']
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)
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
    console.log(`\nwatchtower-github-mcp running on port ${port}`)
  })
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})

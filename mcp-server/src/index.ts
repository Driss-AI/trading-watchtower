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

function buildServer(): McpServer {
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
          size: (e as any).size ?? 0,
          path: e.path,
        }))
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] }
      } catch (err: any) {
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
        const file = data as any
        const content = Buffer.from(file.content, 'base64').toString('utf-8')
        return { content: [{ type: 'text', text: content }] }
      } catch (err: any) {
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
      } catch (err: any) {
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
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Error searching: ${err.message}` }], isError: true }
      }
    }
  )

  return server
}

// Session store - keeps transports alive between initialize and tool calls
const sessions = new Map<string, StreamableHTTPServerTransport>()

async function main(): Promise<void> {
  if (!GITHUB_TOKEN) {
    console.error('WARNING: GITHUB_TOKEN env var is not set - API calls will fail (401).')
  }

  const app = express()
  app.use(express.json())

  console.log(`   MCP endpoint: POST /mcp`)
  console.log(`   Health check: GET /health`)
  console.log(`   Repo: ${GITHUB_OWNER}/${GITHUB_REPO} (branch: ${GITHUB_BRANCH})`)

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', repo: `${GITHUB_OWNER}/${GITHUB_REPO}`, hasToken: !!GITHUB_TOKEN })
  })

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!
      await transport.handleRequest(req, res, req.body)
      return
    }

    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        sessions.set(id, transport)
      },
    })

    res.on('close', () => {
      const id = transport.sessionId
      if (id) sessions.delete(id)
      transport.close()
      server.close()
    })

    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use POST.' })
  })
  app.delete('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use POST.' })
  })

  const port = parseInt(process.env.PORT ?? '8080', 10)
  app.listen(port, () => {
    console.log(`\n✅ watchtower-github-mcp running on port ${port}`)
  })
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})

import { mkdir, readFile, writeFile } from 'node:fs/promises'

const REGISTRY = 'https://registry.npmjs.org/'
const DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week/'
const MAX_VERSIONS = 40
const CONCURRENCY = 6

const seeds = JSON.parse(await readFile(new URL('./plugins.json', import.meta.url), 'utf8'))

function npmDocUrl(name) {
  return `${REGISTRY}${name.replace('/', '%2F')}`
}

function normalizeRepository(repository) {
  if (!repository) return undefined
  let url = typeof repository === 'string' ? repository : repository?.url
  if (!url) return undefined
  url = url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '')
  return url.startsWith('http://') || url.startsWith('https://') ? url : undefined
}

function authorName(author) {
  if (typeof author === 'string') return author
  if (author && typeof author.name === 'string') return author.name
  return undefined
}

function dshRange(pkg) {
  const direct = pkg?.engines?.dsh
  if (typeof direct === 'string' && direct.trim()) return direct.trim()

  const peerRanges = Object.entries(pkg?.peerDependencies ?? {})
    .filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
    .map(([, range]) => range)
    .filter((range) => typeof range === 'string' && range.trim())
    .map((range) => range.trim())

  if (peerRanges.length > 0 && peerRanges.every((range) => range === peerRanges[0])) {
    return peerRanges[0]
  }
  return undefined
}

async function fetchJson(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500))
    }
  }
  throw lastError
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const index = next++
      output[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return output
}

function buildPlugin(name, packument, downloads) {
  const versionsObject = packument?.versions ?? {}
  const times = packument?.time ?? {}
  const distTags = packument?.['dist-tags'] ?? {}
  const latestVersion = distTags.latest ?? Object.keys(versionsObject).at(-1)
  const latestPkg = latestVersion ? versionsObject[latestVersion] : undefined
  if (!latestPkg) return undefined

  const candidates = Object.entries(versionsObject)
    .filter(([, pkg]) => pkg?.dsh?.bundle)
    .map(([version, pkg]) => {
      const timestamp = Date.parse(times[version] ?? '')
      return {
        pkg,
        version,
        timestamp: Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0,
      }
    })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_VERSIONS)
    .sort((a, b) => a.timestamp - b.timestamp)

  if (candidates.length === 0) return undefined

  const includedVersions = new Set(candidates.map(({ version }) => version))
  const filteredTags = Object.fromEntries(
    Object.entries(distTags).filter(([, version]) => includedVersions.has(version)),
  )

  const versions = candidates.map(({ version, timestamp, pkg }) => {
    const range = dshRange(pkg)
    const result = {
      version,
      publishTimestamp: timestamp,
      source: { type: 'npm' },
    }
    if (range) result.engines = { dsh: range }
    return result
  })

  const plugin = {
    name,
    versions,
  }

  if (typeof latestPkg.description === 'string' && latestPkg.description.trim()) {
    plugin.description = latestPkg.description.trim()
  }
  const author = authorName(latestPkg.author)
  if (author) plugin.author = author
  const repository = normalizeRepository(latestPkg.repository)
  if (repository) plugin.repository = { url: repository }
  if (typeof latestPkg.homepage === 'string' && /^https?:\/\//.test(latestPkg.homepage)) {
    plugin.homepage = latestPkg.homepage
  }
  if (Object.keys(filteredTags).length > 0) plugin['dist-tags'] = filteredTags

  const keywords = Array.isArray(latestPkg.keywords)
    ? latestPkg.keywords.filter((keyword) => typeof keyword === 'string')
    : []
  plugin.metadata = {
    keywords,
    sortKeys: { downloads },
  }
  return plugin
}

const uniqueSeeds = [...new Set(seeds)]
const plugins = []
const failures = []

await mapLimit(uniqueSeeds, CONCURRENCY, async (name) => {
  try {
    const [packument, downloadData] = await Promise.all([
      fetchJson(npmDocUrl(name)),
      fetchJson(`${DOWNLOADS}${name}`).catch(() => ({ downloads: 0 })),
    ])
    const plugin = buildPlugin(name, packument, Number(downloadData?.downloads ?? 0))
    if (plugin) {
      plugins.push(plugin)
    } else {
      failures.push(`${name}: no published version declares dsh.bundle`)
    }
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
})

plugins.sort((a, b) => {
  const downloadsA = Number(a.metadata?.sortKeys?.downloads ?? 0)
  const downloadsB = Number(b.metadata?.sortKeys?.downloads ?? 0)
  return downloadsB - downloadsA || a.name.localeCompare(b.name)
})

const index = {
  format: 1,
  title: {
    en: 'Haimin DSH Plugin Index',
    zh: '海敏 DSH 插件索引',
  },
  description: {
    en: 'A curated, automatically refreshed index of installable DSH bundles from npm.',
    zh: '从 npm 精选并自动刷新的可安装 DSH 插件索引。',
  },
  metadata: {
    sortKeys: {
      downloads: {
        title: {
          en: 'Weekly downloads',
          zh: '周下载量',
        },
        order: 'desc',
      },
    },
  },
  plugins,
}

const json = `${JSON.stringify(index, null, 2)}\n`
await writeFile(new URL('./index.json', import.meta.url), json)
await mkdir(new URL('./_site', import.meta.url), { recursive: true })
await writeFile(new URL('./_site/index.json', import.meta.url), json)
await writeFile(
  new URL('./_site/index.html', import.meta.url),
  `<!doctype html><meta charset="utf-8"><title>Haimin DSH Plugin Index</title><p>DSH index source: <a href="./index.json">index.json</a></p>\n`,
)

console.log(`Built index with ${plugins.length} plugins and ${failures.length} skipped entries.`)
if (failures.length > 0) {
  console.log(failures.join('\n'))
}

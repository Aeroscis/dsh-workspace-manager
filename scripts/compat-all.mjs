#!/usr/bin/env node
/**
 * 一次跑完几个插件仓库的宿主接口检查，给出总表。
 *
 * 为什么不逐个 cd 进去跑：定时任务需要一条命令、一个退出码、一份能直接贴出来的结论。
 * 逐个跑要在 prompt 里写循环，每次都重新拼一遍输出。
 *
 * 退出码沿用以最严重的那个为准：30（无法判定）> 20（会被拒载）> 10（接口变了）> 0。
 * 这样定时任务只看退出码就能决定要不要展开分析。
 *
 * 用法：
 *
 *   node scripts/compat-all.mjs            人类可读总表
 *   node scripts/compat-all.mjs --json     机器可读
 *   node scripts/compat-all.mjs --quiet    只在有仓库需要处理时输出（给定时任务用）
 *
 * 仓库列表默认取本文件所在目录的兄弟目录，可用 --roots 指定。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.dirname(path.dirname(HERE))

const REPOS = [
  'dsh-workspace-manager',
  'dsh-temptask',
  'dsh-run-deck',
  'dsh-taskoutsource',
]

/** 结论到严重度，用来在多仓库之间取最严重的那个。 */
const SEVERITY = { UNCHANGED: 0, 'NO-BASELINE': 1, DRIFT: 2, 'OUT-OF-RANGE': 3, UNVERIFIABLE: 4, MISSING: 4 }

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const quiet = argv.includes('--quiet')
const rootsArg = argv.indexOf('--roots')
const root = rootsArg >= 0 && argv[rootsArg + 1] !== undefined ? argv[rootsArg + 1] : DEFAULT_ROOT

function probe(repo) {
  const dir = path.join(root, repo)
  const script = path.join(dir, 'scripts', 'compat-probe.mjs')
  if (!fs.existsSync(script)) {
    return { repo, verdict: 'MISSING', exitCode: 30, summary: '没有 compat-probe.mjs' }
  }

  const run = spawnSync(process.execPath, [script, '--json'], { cwd: dir, encoding: 'utf8' })
  const exitCode = run.status ?? 30
  let parsed
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return {
      repo,
      verdict: 'UNVERIFIABLE',
      exitCode,
      summary: `探针没有输出可解析的结果（exit=${exitCode}）`,
    }
  }

  const summary =
    parsed.verdict === 'UNVERIFIED' || parsed.verdict === 'UNVERIFIABLE'
      ? (parsed.reason ?? '无法判定')
      : parsed.verdict === 'OUT-OF-RANGE'
        ? Object.entries(parsed.range?.unmet ?? {})
            .map(([name, range]) => `${name} 要求 ${range}`)
            .join('；')
        : parsed.verdict === 'DRIFT'
          ? parsed.changes.join('；')
          : parsed.runtime?.version !== undefined
            ? `宿主 ${parsed.runtime.version}`
            : ''

  return {
    repo,
    verdict: parsed.verdict ?? 'UNVERIFIABLE',
    exitCode,
    runtime: parsed.runtime?.version,
    baseline: parsed.baseline?.runtime,
    summary,
    // 只有版本号变化时把变化数带出来，让人知道宿主确实换了。
    versionOnly: parsed.versionOnly?.length ?? 0,
    changes: parsed.changes ?? [],
  }
}

const results = REPOS.map(probe)
const worst = results.reduce(
  (acc, item) => Math.max(acc, SEVERITY[item.verdict] ?? 4),
  0,
)
const needsAttention = results.filter((item) => item.verdict !== 'UNCHANGED')

if (asJson) {
  process.stdout.write(`${JSON.stringify({ root, worst, results }, null, 2)}\n`)
} else if (quiet && needsAttention.length === 0) {
  // 一切正常时只给一行，定时任务据此判断「不用展开」。
  const runtime = results.find((item) => item.runtime !== undefined)?.runtime ?? '未知'
  process.stdout.write(`全部正常（宿主 ${runtime}，${results.length} 个插件仓库接口未变）\n`)
} else {
  console.log(`检查目录  ${root}`)
  console.log('')
  for (const item of results) {
    const badge = item.verdict.padEnd(14)
    console.log(`${badge} ${item.repo}`)
    if (item.summary.length > 0) console.log(`               ${item.summary}`)
    if (item.versionOnly > 0 && item.verdict === 'UNCHANGED') {
      console.log(`               （宿主 ${item.baseline} → ${item.runtime}，${item.versionOnly} 个包版本号变了，接口未变）`)
    }
  }
  console.log('')
  console.log(
    needsAttention.length === 0
      ? `结论：${results.length} 个仓库都不需要适配。`
      : `结论：${needsAttention.map((item) => item.repo).join('、')} 需要处理。`,
  )
}

const exitCode =
  worst >= SEVERITY.UNVERIFIABLE ? 30 : worst === SEVERITY['OUT-OF-RANGE'] ? 20 : worst >= SEVERITY.DRIFT ? 10 : 0
process.exitCode = exitCode

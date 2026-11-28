// Seed closed Sessions into a JSONL persistence root (evidence only). Usage: tsx seed.ts <root> <cwd::title>...
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { parseSessionLog, prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

const [root, fixturePath, ...specs] = process.argv.slice(2)
const fixture = await readFile(fixturePath!, 'utf8')
const now = Date.now()
for (const [index, spec] of specs.entries()) {
  const [cwd, title] = spec.split('::') as [string, string]
  const id = randomUUID()
  const text = fixture.split('{{cwd}}').join(cwd).split('{{session:1}}').join(id).split('{{sessionId}}').join(id)
    .replace('"title":"Use the read tool twice"', `"title":${JSON.stringify(title)}`)
  const events = parseSessionLog(prepareSessionSnapshotFixtureForComparison(text))
  const createdAt = now - (index + 1) * 600_000
  const meta: SessionHeader = { version: SESSION_FORMAT_VERSION, id: brandString<SessionId>(id), createdAt, isSeeded: false, cwd, delegationDepth: 0 }
  const timed = events.map((event, n) => ({ ...event, time: createdAt + n })) as SessionEvent[]
  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root }).await()
  const handle = await ctx.sessionPersistence.create(meta)
  await handle.append(timed)
  await handle.close()
  await ctx.fiber.dispose()
  console.log(id, cwd, title)
}

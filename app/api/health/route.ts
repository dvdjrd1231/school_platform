import mongoose from "mongoose"

import { connectDB, redactUri } from "@/lib/db/connect"

export const runtime = "nodejs"
// Never cache a health check — a stale "ok" is worse than no check at all.
export const dynamic = "force-dynamic"

/**
 * GET /api/health — deployment diagnostics.
 *
 * Reports only whether each variable is *present*, never its value, so this is
 * safe to leave reachable. Connection errors are redacted before being
 * returned, since a driver error can echo the credentials back.
 */
export async function GET() {
  const env = {
    MONGODB_URI: Boolean(process.env.MONGODB_URI),
    MONGODB_URL: Boolean(process.env.MONGODB_URL),
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    AUTH_SECRET: Boolean(process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET),
    ADMIN_USER: Boolean(process.env.ADMIN_USER),
    ADMIN_PASSWORD: Boolean(process.env.ADMIN_PASSWORD),
    PUSHER_APP_ID: Boolean(process.env.PUSHER_APP_ID),
    PUSHER_KEY: Boolean(process.env.PUSHER_KEY),
    PUSHER_SECRET: Boolean(process.env.PUSHER_SECRET),
    PUSHER_CLUSTER: Boolean(process.env.PUSHER_CLUSTER),
    NEXT_PUBLIC_PUSHER_KEY: Boolean(process.env.NEXT_PUBLIC_PUSHER_KEY),
  }

  const database: {
    connected: boolean
    name?: string
    collections?: string[]
    userCount?: number
    error?: string
  } = { connected: false }

  try {
    const conn = await connectDB()
    const db = conn.connection.db
    database.connected = conn.connection.readyState === 1
    database.name = conn.connection.name

    if (db) {
      const collections = await db.listCollections().toArray()
      database.collections = collections.map((c) => c.name).sort()
      // A zero here means the database is reachable but unseeded — the most
      // common reason sign-in fails on a fresh deployment.
      database.userCount = await db.collection("users").countDocuments()
    }
  } catch (err) {
    database.error = redactUri(err instanceof Error ? err.message : String(err))
  }

  const ready = database.connected && env.AUTH_SECRET
  const problems: string[] = []
  if (!env.MONGODB_URI && !env.MONGODB_URL && !env.DATABASE_URL) {
    problems.push("No MongoDB connection string is set.")
  }
  if (!env.AUTH_SECRET) {
    problems.push("AUTH_SECRET is not set — sign-in cannot issue sessions.")
  }
  if (database.connected && database.userCount === 0) {
    problems.push("Database is reachable but has no users. Run `pnpm seed`.")
  }
  if (database.error) {
    problems.push(`Database connection failed: ${database.error}`)
  }

  return Response.json({ ready, env, database, problems }, { status: ready ? 200 : 503 })
}

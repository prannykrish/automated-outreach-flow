#!/usr/bin/env node
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'org-assets'

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function emptyBucket(bucket) {
  const batchSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list('', { limit: batchSize, offset })
    if (error) throw error
    if (!data || data.length === 0) break

    const paths = data.map((item) => item.name)
    if (paths.length > 0) {
      const { error: delErr } = await supabase.storage.from(bucket).remove(paths)
      if (delErr) throw delErr
      console.log(`Deleted ${paths.length} objects (offset ${offset})`)
    }

    if (data.length < batchSize) break
    offset += data.length
  }
  console.log('Bucket emptied (objects removed).')
}

emptyBucket(BUCKET)
  .then(() => {
    console.log('\nDone. The bucket has been emptied.\nYou must now delete the bucket itself via the Supabase Dashboard or CLI (see README).')
  })
  .catch((err) => {
    console.error('Error emptying bucket:', err)
    process.exit(1)
  })

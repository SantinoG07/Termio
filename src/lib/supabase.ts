import { createClient } from '@supabase/supabase-js'

const local = import.meta.env.VITE_DATA_SOURCE === 'local'
const url = local ? undefined : import.meta.env.VITE_SUPABASE_URL?.trim()
const key = local ? undefined : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const configurationError = (!!url !== !!key) ? 'Completá las dos variables de Supabase en .env.local y reiniciá Vite.' : null
export const supabase = url && key ? createClient(url, key) : null

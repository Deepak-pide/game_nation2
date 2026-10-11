import { createClient } from 'npm:@supabase/supabase-js@2';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: jsonHeaders });

  const authorization = request.headers.get('authorization') || '';
  const deviceToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!deviceToken || deviceToken.length < 32 || deviceToken.length > 256) {
    return Response.json({ error: 'Device authentication required' }, { status: 401, headers: jsonHeaders });
  }

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: jsonHeaders });
  }
  if (!['online', 'offline', 'maintenance'].includes(String(body.status))) {
    return Response.json({ error: 'Invalid device status' }, { status: 400, headers: jsonHeaders });
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deviceToken));
  const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: 'Device status service is not configured' }, { status: 503, headers: jsonHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: device, error: lookupError } = await supabase.from('devices')
    .select('id,console_id').eq('token_hash', tokenHash).eq('enabled', true).maybeSingle();
  if (lookupError) return Response.json({ error: 'Device lookup failed' }, { status: 503, headers: jsonHeaders });
  if (!device) return Response.json({ error: 'Device is not authorized' }, { status: 401, headers: jsonHeaders });

  const { error: writeError } = await supabase.from('console_status').upsert({
    device_id: device.id,
    console_id: device.console_id,
    status: body.status,
    reported_at: new Date().toISOString(),
  });
  if (writeError) return Response.json({ error: 'Could not record device status' }, { status: 503, headers: jsonHeaders });
  return Response.json({ ok: true }, { status: 200, headers: jsonHeaders });
});
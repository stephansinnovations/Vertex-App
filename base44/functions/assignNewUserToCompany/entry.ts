import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const VERTEX_VANS_COMPANY_ID = '699bc3c65ff184d7ed8449e5';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const userId = body?.event?.entity_id;
    if (!userId) {
      return Response.json({ error: 'No user id in payload' }, { status: 400 });
    }

    // Get the user
    const users = await base44.asServiceRole.entities.User.filter({ id: userId });
    const user = users[0];

    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    // Only assign if not already assigned
    if (user.company_id) {
      return Response.json({ message: 'User already has a company' });
    }

    await base44.asServiceRole.entities.User.update(userId, {
      company_id: VERTEX_VANS_COMPANY_ID
    });

    return Response.json({ success: true, message: 'User assigned to Vertex Vans' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
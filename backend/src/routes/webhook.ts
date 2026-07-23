import { Hono } from 'hono';
import { config } from '../utils/config.js';

export const webhookRoutes = new Hono();

// POST /jotform
webhookRoutes.post('/jotform', async (c) => {
  const secret = c.req.query('secret');
  if (!config.JOTFORM_WEBHOOK_SECRET || secret !== config.JOTFORM_WEBHOOK_SECRET) {
    return c.json({ error: 'Invalid webhook secret' }, 401);
  }

  try {
    const body = await c.req.json().catch(() => c.req.text());

    let formData: Record<string, any>;
    if (typeof body === 'string') {
      formData = JSON.parse(body);
    } else if (body.rawRequest) {
      formData = typeof body.rawRequest === 'string' ? JSON.parse(body.rawRequest) : body.rawRequest;
    } else {
      formData = body;
    }

    const formID = String(formData.formID || formData.formId || '');
    const submissionID = String(formData.submissionID || formData.submissionId || '');

    console.log(`[Webhook] Received JotForm submission ${submissionID} for form ${formID}`);

    return c.json({
      success: true,
      message: 'Submission received. PDF will be pulled from Google Drive.',
    });
  } catch (err) {
    console.error('[Webhook] Error processing JotForm webhook:', err);
    return c.json({ error: 'Internal error processing webhook' }, 500);
  }
});

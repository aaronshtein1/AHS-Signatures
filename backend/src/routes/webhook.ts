import { FastifyPluginAsync } from 'fastify';
import { config } from '../utils/config.js';

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  // JotForm webhook endpoint - receives notification of new submissions
  // With HIPAA JotForm, PDFs are pulled via Google Drive integration instead
  fastify.post('/jotform', async (request, reply) => {
    // Verify webhook secret
    const secret = (request.query as Record<string, string>).secret;
    if (!config.JOTFORM_WEBHOOK_SECRET || secret !== config.JOTFORM_WEBHOOK_SECRET) {
      return reply.status(401).send({ error: 'Invalid webhook secret' });
    }

    try {
      const body = request.body as Record<string, any>;

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

      // PDFs are synced via Google Drive, not downloaded from JotForm API
      // This webhook just logs the notification
      return {
        success: true,
        message: 'Submission received. PDF will be pulled from Google Drive.',
      };
    } catch (err) {
      console.error('[Webhook] Error processing JotForm webhook:', err);
      return reply.status(500).send({ error: 'Internal error processing webhook' });
    }
  });
};

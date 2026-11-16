import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { query } from '../../config/db.js';

const genAI = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : null;

/** Plain-text explanation used when Gemini is not available. */
export function templateExplanation(score, reasons) {
  const indicators = reasons.length > 0 ? reasons.join('; ') : 'Exceeded the automated hold threshold';
  return `Flagged by the automated risk engine (Risk Score: ${score}/100). Key risk indicators: ${indicators}.`;
}

/**
 * Write a short explanation for a held transfer so a human reviewer understands it quickly.
 * Only anonymous signals are sent to Gemini (no names, emails or account numbers).
 * If Gemini fails for any reason, the template text is stored instead.
 */
export async function generateRiskExplanation({ riskAssessmentId, score, signals = {}, reasons = [] }) {
  const fallback = templateExplanation(score, reasons);

  if (!genAI) {
    return saveExplanation(riskAssessmentId, fallback, 'TEMPLATE_FALLBACK');
  }

  const prompt = `
You are a financial risk analyst helping a human compliance officer review a flagged payment.
In exactly 2 short, factual sentences, summarize the risk based only on these signals:
- Risk score: ${score} / 100
- Amount compared with the 30-day average: ${signals.amountRatio ? `${signals.amountRatio}x` : 'normal'}
- Transfers in the last 10 minutes: ${signals.velocity10m ?? 'unavailable'}
- Unrecognized device: ${signals.newDevice ? 'yes' : 'no'}
- First payment to this recipient: ${signals.newPayee ? 'yes' : 'no'}
- Night-time transfer (IST): ${signals.offHours ? 'yes' : 'no'}
- Location anomaly: ${signals.locationMismatch ? 'yes' : 'no'}
- Reasons from the rule engine: ${reasons.join(', ')}
Reply with the 2 sentences only, without markdown.`.trim();

  try {
    const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini timed out after 5s')), 5000));
    const result = await Promise.race([model.generateContent(prompt), timeout]);
    return saveExplanation(riskAssessmentId, result.response.text().trim(), 'GEMINI');
  } catch (err) {
    logger.warn({ err: err.message, riskAssessmentId }, 'Gemini explanation failed, using template text');
    return saveExplanation(riskAssessmentId, fallback, 'TEMPLATE_FALLBACK');
  }
}

async function saveExplanation(riskAssessmentId, explanation, source) {
  try {
    await query(
      'UPDATE risk_assessments SET explanation = $1, explanation_source = $2 WHERE id = $3;',
      [explanation, source, riskAssessmentId]
    );
  } catch (err) {
    logger.error({ err: err.message, riskAssessmentId }, 'Could not save risk explanation');
  }
  return { explanation, source };
}

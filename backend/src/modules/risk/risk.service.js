import { query } from '../../config/db.js';
import { redisClient } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

/**
 * The rule-based risk engine. It only reads data and returns a score from 0 to 100
 * with the reasons behind it. It never moves money and never touches the ledger.
 * Each signal is checked on its own: if one cannot be read (for example Redis is down)
 * it is skipped and the result is marked signalsIncomplete.
 *
 * Signals and points:
 *  amount 2x / 3x / 5x the 30-day average  +10 / +15 / +25
 *  3 / 5 transfers in the last 10 minutes  +15 / +25
 *  unrecognized device                     +20
 *  first payment to this recipient         +15
 *  night-time transfer (1-5 am IST)        +10
 *  location anomaly (simulated input)      +5
 */
export async function evaluateTransferRisk({
  userId,
  sourceAccountId,
  destinationAccountId,
  amount,
  deviceFingerprint = 'unknown-device',
  simulateLocationMismatch = false
}) {
  const signals = {};
  const reasons = [];
  let score = 0;
  let signalsIncomplete = false;

  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };

  // 1. Amount compared with this wallet's 30-day average
  try {
    const { rows: [stats] } = await query(
      `SELECT COALESCE(ROUND(AVG(amount)), 0)::TEXT AS avg_amount, COUNT(*) AS transfer_count
       FROM transfers
       WHERE source_account_id = $1 AND status = 'COMPLETED' AND created_at > NOW() - INTERVAL '30 days';`,
      [sourceAccountId]
    );
    const historyCount = Number(stats?.transfer_count || 0);
    const avgAmount = BigInt(stats?.avg_amount || '0');
    const currentAmount = BigInt(amount);

    signals.historicalCount = historyCount;
    signals.avgAmountPaise = avgAmount.toString();
    signals.amountRatio = 1;

    // Need some history before "unusually large" means anything
    if (historyCount >= 2 && avgAmount > 0n) {
      // Deterministic threshold checks using exact 64-bit integer arithmetic (zero floating-point loss)
      let points = 0;
      if (currentAmount >= 5n * avgAmount) {
        points = 25;
      } else if (currentAmount >= 3n * avgAmount) {
        points = 15;
      } else if (currentAmount >= 2n * avgAmount) {
        points = 10;
      }

      // Display ratio computed using scaled integer arithmetic
      const ratioTimes10 = (currentAmount * 10n) / avgAmount;
      const ratioDisplay = (Number(ratioTimes10) / 10).toFixed(1);
      signals.amountRatio = Number(ratioDisplay);

      if (points > 0) {
        add(points, `Transfer amount is ${ratioDisplay}x the wallet's 30-day average`);
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not compute the amount signal');
    signalsIncomplete = true;
  }

  // 2. How many transfers in the last 10 minutes (counter kept in Redis)
  try {
    const count = Number(await redisClient.get(`velocity:${userId}:10m`)) || 0;
    signals.velocity10m = count;

    if (count >= 5) add(25, `Extreme transfer velocity: ${count} transfers in the past 10 minutes`);
    else if (count >= 3) add(15, `High transfer velocity: ${count} transfers in the past 10 minutes`);
  } catch (err) {
    logger.warn({ err: err.message }, 'Redis unavailable, skipping the velocity signal');
    signalsIncomplete = true;
    signals.velocity10m = null;
    signals.velocityUnavailable = true;
  }

  // 3. Is this a verified trusted device for this user?
  try {
    const device = await query(
      'SELECT id, is_trusted FROM user_devices WHERE user_id = $1 AND device_fingerprint = $2;',
      [userId, deviceFingerprint]
    );
    const isRecognizedAndTrusted = device.rowCount > 0 && device.rows[0].is_trusted === true;
    signals.newDevice = !isRecognizedAndTrusted;
    signals.deviceFingerprint = deviceFingerprint;
    signals.deviceTrusted = isRecognizedAndTrusted;

    if (signals.newDevice) {
      add(20, `Transfer from an untrusted or unrecognized device (${deviceFingerprint})`);
    } else {
      // Update last seen timestamp for recognized trusted device
      await query('UPDATE user_devices SET last_seen_at = NOW() WHERE id = $1;', [device.rows[0].id]);
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not check the device signal');
    signalsIncomplete = true;
  }

  // 4. Has this wallet paid this recipient before?
  try {
    const payee = await query(
      `SELECT 1 FROM transfers
       WHERE source_account_id = $1 AND destination_account_id = $2 AND status = 'COMPLETED'
       LIMIT 1;`,
      [sourceAccountId, destinationAccountId]
    );
    signals.newPayee = payee.rowCount === 0;
    if (signals.newPayee) add(15, 'First transfer to this recipient');
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not check the payee signal');
    signalsIncomplete = true;
  }

  // 5. Time of day in India (IST = UTC + 5:30)
  const istHour = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
  signals.istHour = istHour;
  signals.offHours = istHour >= 1 && istHour <= 5;
  if (signals.offHours) add(10, `Transfer made at night (${istHour}:00 IST)`);

  // 6. Location anomaly. Simulated by the caller, because there is no real geo data in this project.
  signals.locationMismatch = simulateLocationMismatch;
  if (simulateLocationMismatch) add(5, 'Location does not match the account home region');

  const finalScore = Math.min(Math.max(score, 0), 100);
  const decision = finalScore >= env.HOLD_THRESHOLD ? 'HOLD' : 'ALLOW';
  logger.info({ userId, finalScore, decision, signalsIncomplete }, 'Transfer risk evaluated');

  return { score: finalScore, decision, signals, reasons, signalsIncomplete };
}

/** Count a completed transfer for the 10-minute velocity signal. Failure here is harmless. */
export async function incrementUserVelocity(userId) {
  try {
    const key = `velocity:${userId}:10m`;
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.expire(key, 600); // the counter disappears after 10 minutes
  } catch (err) {
    logger.warn({ userId, err: err.message }, 'Could not update the velocity counter');
  }
}


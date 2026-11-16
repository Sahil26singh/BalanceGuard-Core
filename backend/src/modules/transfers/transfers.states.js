import { AppError } from '../../utils/errors.js';

export const STATUS = {
  PENDING: 'PENDING',
  PENDING_PROVIDER: 'PENDING_PROVIDER',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  HELD_FOR_REVIEW: 'HELD_FOR_REVIEW',
  REJECTED: 'REJECTED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
  REVERSED: 'REVERSED'
};

// Which status a transfer may move to next. Anything else is rejected.
const ALLOWED = {
  [STATUS.PENDING]: [STATUS.COMPLETED, STATUS.FAILED, STATUS.HELD_FOR_REVIEW, STATUS.PENDING_PROVIDER],
  [STATUS.PENDING_PROVIDER]: [STATUS.COMPLETED, STATUS.FAILED, STATUS.REVERSED],
  [STATUS.HELD_FOR_REVIEW]: [STATUS.COMPLETED, STATUS.REJECTED, STATUS.PENDING_PROVIDER],
  [STATUS.COMPLETED]: [STATUS.PARTIALLY_REFUNDED, STATUS.REFUNDED],
  [STATUS.PARTIALLY_REFUNDED]: [STATUS.PARTIALLY_REFUNDED, STATUS.REFUNDED],
  [STATUS.FAILED]: [STATUS.REVERSED],
  [STATUS.REJECTED]: [],
  [STATUS.REFUNDED]: [],
  [STATUS.REVERSED]: []
};

/** Throw if a transfer is not allowed to move from one status to another. */
export function assertValidTransition(from, to) {
  if (from === to) return;

  const allowed = ALLOWED[from] || [];
  if (!allowed.includes(to)) {
    throw new AppError(
      422,
      'INVALID_STATE_TRANSITION',
      `A transfer cannot move from ${from} to ${to}. Allowed: ${allowed.join(', ') || 'none'}`
    );
  }
}

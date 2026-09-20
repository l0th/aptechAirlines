/**
 * Requirement 1.3.4: Consistent input validation constants across backend DTOs.
 */

/**
 * International phone number regex:
 * - Optional leading '+'
 * - Digits, spaces, parentheses, hyphens, and dots allowed
 * - Requires between 7 and 15 digits (ITU-T E.164 standard)
 * - Rejects punctuation-only strings like '+++++++' or too-short numbers
 */
export const PHONE_NUMBER_REGEX = /^(?=(?:\D*\d){7,15}\D*$)\+?[0-9\s().-]+$/;
export const PHONE_NUMBER_MESSAGE =
  'phone_number must be a valid phone number with 7 to 15 digits';

/**
 * Payment card number regex:
 * - Only digits, spaces, and hyphens allowed
 * - Requires between 12 and 19 digits (industry standard)
 * - Rejects malformed strings, non-numeric characters, or out-of-range lengths
 */
export const CREDIT_CARD_REGEX = /^(?=(?:\D*\d){12,19}\D*$)[0-9\s-]+$/;
export const CREDIT_CARD_MESSAGE =
  'credit card number must contain between 12 and 19 digits';

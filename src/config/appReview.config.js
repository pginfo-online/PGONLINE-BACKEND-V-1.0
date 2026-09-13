'use strict';

/**
 * appReview.config.js — App Store Review Configuration & Validation
 *
 * Temporary authentication bypass for Apple App Store Connect reviewers.
 * Enables Apple review teams to sign in with a dedicated test phone number
 * and fixed OTP without triggering SMS delivery fees or requiring an Indian SIM.
 *
 * Designed for effortless removal:
 *  - Set APP_REVIEW_ENABLED=false in .env to disable immediately
 *  - Or delete this file and the marked blocks in auth.controller.js after review
 */

const APP_REVIEW_ENABLED = process.env.APP_REVIEW_ENABLED !== 'false';
const APP_REVIEW_PHONE = process.env.APP_REVIEW_PHONE || '9999900001';
const APP_REVIEW_OTP = process.env.APP_REVIEW_OTP || '1234';

/**
 * Normalise any raw phone input into clean 10 digits
 * Handles +91, 91, 0 prefixes and non-digit characters
 *
 * @param {string} phone
 * @returns {string} 10-digit number string
 */
const normalizePhoneNumber = (phone) => {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(3);
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
};

/**
 * Check if the provided contact matches the App Store Review phone number
 *
 * @param {string} contact - Phone number or email
 * @returns {boolean}
 */
const isAppReviewContact = (contact) => {
  if (!APP_REVIEW_ENABLED) return false;
  if (!contact) return false;
  const normalized = normalizePhoneNumber(contact);
  const target = normalizePhoneNumber(APP_REVIEW_PHONE);
  return normalized === target && normalized.length === 10;
};

/**
 * Verify if the entered OTP matches the fixed App Store Review OTP
 *
 * @param {string} otp - 4-digit OTP code entered by user
 * @returns {boolean}
 */
const isAppReviewOtpValid = (otp) => {
  if (!APP_REVIEW_ENABLED) return false;
  if (!otp) return false;
  return String(otp).trim() === String(APP_REVIEW_OTP).trim();
};

module.exports = {
  APP_REVIEW_ENABLED,
  APP_REVIEW_PHONE,
  APP_REVIEW_OTP,
  normalizePhoneNumber,
  isAppReviewContact,
  isAppReviewOtpValid,
};

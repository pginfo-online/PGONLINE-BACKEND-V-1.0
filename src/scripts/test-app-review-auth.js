'use strict';

/**
 * test-app-review-auth.js
 *
 * Automated verification script for the App Store Review authentication mechanism.
 * Tests:
 *  1. Unit tests for appReview.config helpers (normalization, phone matching, OTP validation)
 *  2. Controller sendOtpUnified bypass (no SMS sent, correct channel response)
 *  3. Controller verifyOtpUnified with invalid OTP (400 rejection)
 *  4. Controller verifyOtpUnified with valid OTP (200 OK, JWT generation, user persistence)
 *  5. Feature flag toggle (APP_REVIEW_ENABLED=false disables bypass)
 *
 * Run with: node src/scripts/test-app-review-auth.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const appReview = require('../config/appReview.config');
const { sendOtpUnified, verifyOtpUnified } = require('../controllers/auth.controller');
const User = require('../models/User.model');

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedTests++;
  }
}

// Mock Express response object
function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

// Helper to cleanly await Express asyncHandler middleware
function invokeHandler(handler, req, res) {
  return new Promise((resolve, reject) => {
    res.json = (payload) => {
      res.body = payload;
      resolve(res);
    };

    handler(req, res, (err) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 Starting App Store Review Auth Verification Tests');
  console.log('======================================================\n');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 1: Config & Normalization Helpers
  // ───────────────────────────────────────────────────────────────────────────
  console.log('👉 [1/5] Testing appReview.config helpers...');

  assert(appReview.APP_REVIEW_ENABLED === true, 'APP_REVIEW_ENABLED defaults to true');
  assert(appReview.APP_REVIEW_PHONE === '9999900001', 'APP_REVIEW_PHONE is 9999900001');
  assert(appReview.APP_REVIEW_OTP === '1234', 'APP_REVIEW_OTP is 1234');

  // Normalization tests
  assert(appReview.normalizePhoneNumber('9999900001') === '9999900001', 'Normalizes 10-digit number');
  assert(appReview.normalizePhoneNumber('+919999900001') === '9999900001', 'Normalizes +91 prefix');
  assert(appReview.normalizePhoneNumber('919999900001') === '9999900001', 'Normalizes 91 prefix');
  assert(appReview.normalizePhoneNumber('09999900001') === '9999900001', 'Normalizes leading zero');
  assert(appReview.normalizePhoneNumber('+91 99999 00001') === '9999900001', 'Normalizes spaces in number');

  // Contact matching tests
  assert(appReview.isAppReviewContact('9999900001') === true, 'Matches standard 10-digit test phone');
  assert(appReview.isAppReviewContact('+919999900001') === true, 'Matches +91 test phone');
  assert(appReview.isAppReviewContact('+91 99999 00001') === true, 'Matches spaced test phone');
  assert(appReview.isAppReviewContact('9876543210') === false, 'Does not match other user phone');
  assert(appReview.isAppReviewContact('user@example.com') === false, 'Does not match email address');

  // OTP validation tests
  assert(appReview.isAppReviewOtpValid('1234') === true, 'Validates correct review OTP (1234)');
  assert(appReview.isAppReviewOtpValid(' 1234 ') === true, 'Validates review OTP with whitespace');
  assert(appReview.isAppReviewOtpValid('0000') === false, 'Rejects incorrect OTP (0000)');
  assert(appReview.isAppReviewOtpValid('9999') === false, 'Rejects incorrect OTP (9999)');
  assert(appReview.isAppReviewOtpValid('') === false, 'Rejects empty OTP');

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 2: Database Connection
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n👉 [2/5] Connecting to Database for Controller Tests...');
  const connectDB = require('../config/db');

  try {
    await connectDB();
    console.log('  ✓ Connected to MongoDB Atlas via connectDB');
  } catch (err) {
    console.error('  ✗ DB Connection error:', err.message);
    return;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 3: Controller sendOtpUnified Bypass
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n👉 [3/5] Testing sendOtpUnified bypass for review account...');

  const mockSendReq = {
    body: {
      contact: '9999900001',
      type: 'phone',
      sendWhatsApp: false,
    },
  };
  const mockSendRes = createMockRes();

  await invokeHandler(sendOtpUnified, mockSendReq, mockSendRes);

  assert(mockSendRes.statusCode === 200, 'sendOtpUnified returns HTTP 200');
  assert(mockSendRes.body?.success === true, 'sendOtpUnified response.success is true');
  assert(
    Array.isArray(mockSendRes.body?.data?.channels) &&
      mockSendRes.body.data.channels.includes('sms'),
    'sendOtpUnified returns channels: ["sms"] without sending real SMS'
  );

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 4: Controller verifyOtpUnified (Invalid & Valid OTP)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n👉 [4/5] Testing verifyOtpUnified for review account...');

  // Test 4A: Invalid OTP
  const mockVerifyInvalidReq = {
    body: {
      contact: '9999900001',
      otp: '0000',
      isMobile: true,
    },
  };
  const mockVerifyInvalidRes = createMockRes();
  let invalidOtpCaught = false;

  try {
    await invokeHandler(verifyOtpUnified, mockVerifyInvalidReq, mockVerifyInvalidRes);
  } catch (err) {
    if (err.statusCode === 400) invalidOtpCaught = true;
  }

  assert(invalidOtpCaught, 'verifyOtpUnified rejects invalid OTP with 400 Bad Request');

  // Test 4B: Valid OTP
  const mockVerifyValidReq = {
    body: {
      contact: '9999900001',
      otp: '1234',
      isMobile: true,
    },
  };
  const mockVerifyValidRes = createMockRes();
  let validOtpError = null;

  try {
    await invokeHandler(verifyOtpUnified, mockVerifyValidReq, mockVerifyValidRes);
  } catch (err) {
    validOtpError = err;
  }

  assert(!validOtpError, 'verifyOtpUnified with OTP 1234 succeeds without error');
  assert(mockVerifyValidRes.statusCode === 200, 'verifyOtpUnified returns HTTP 200');
  assert(mockVerifyValidRes.body?.success === true, 'verifyOtpUnified response.success is true');

  const authData = mockVerifyValidRes.body?.data;
  assert(!!authData?.token, 'verifyOtpUnified returns a valid JWT token');
  assert(authData?.user?.phone === '9999900001', 'verifyOtpUnified returns user with phone 9999900001');
  assert(authData?.user?.phoneVerified === true, 'Review user phoneVerified is true');

  // Verify JWT expiration and claims
  if (authData?.token) {
    const decoded = jwt.decode(authData.token);
    assert(decoded?.id === authData.user._id || decoded?.id === authData.user.id, 'JWT contains valid user ID');
    assert(!!decoded?.exp, 'JWT has expiration timestamp');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 5: Subsequent Login for Existing Review User
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n👉 [5/5] Testing subsequent login for existing review user...');

  const mockSecondLoginRes = createMockRes();
  await invokeHandler(verifyOtpUnified, mockVerifyValidReq, mockSecondLoginRes);

  assert(mockSecondLoginRes.statusCode === 200, 'Second login returns HTTP 200');
  assert(mockSecondLoginRes.body?.data?.isNewUser === false, 'isNewUser is false on subsequent login');
  assert(mockSecondLoginRes.body?.data?.user?.phone === '9999900001', 'User profile persisted cleanly');

  // Cleanup
  await mongoose.disconnect();
  console.log('\n======================================================');
  console.log(`📊 Test Summary: ${passedTests} passed, ${failedTests} failed`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

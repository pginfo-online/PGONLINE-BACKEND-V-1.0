const assert = require('assert');
const {
  createPGRoomSchema,
  updateRentRecordSchema,
  sendReminderSchema,
  refundPaymentSchema,
  createPaymentLinkSchema,
  addTenantSchema,
  updateTenantSchema,
} = require('../src/validators/manage.validator');
const { formatPhoneNumber, TEMPLATES } = require('../src/services/notification/whatsapp.service');
const {
  buildRentReminderHtml,
  buildPaymentConfirmationHtml,
  buildWelcomeTenantHtml,
} = require('../src/services/notification/email.service');

console.log('🧪 Starting Backend Production Test Suite...\n');

// ─── Test 1: createPGRoomSchema Validation ──────────────────────────────────
console.log('▶ Test 1: Room-First createPGRoomSchema');
{
  // Valid room-first payload without building/floor (should use defaults)
  const validPayload = {
    roomNumber: '101',
    shareType: 'double',
    rentPerBed: 6500,
    depositAmount: 10000,
    floorLabel: 'ground',
    hasMeter: true,
  };
  const parsed = createPGRoomSchema.parse(validPayload);
  assert.strictEqual(parsed.roomNumber, '101');
  assert.strictEqual(parsed.shareType, 'double');
  assert.strictEqual(parsed.floorLabel, 'ground');
  assert.strictEqual(parsed.hasMeter, true);
  assert.strictEqual(parsed.status, 'active');

  // Negative rent should fail
  assert.throws(() => {
    createPGRoomSchema.parse({ roomNumber: '102', rentPerBed: -500 });
  }, /Rent cannot be negative/);

  // Missing roomNumber should fail
  assert.throws(() => {
    createPGRoomSchema.parse({ rentPerBed: 5000 });
  });

  console.log('  ✅ createPGRoomSchema passed valid and invalid checks');
}

// ─── Test 2: addTenantSchema with New Enhancements ──────────────────────────
console.log('\n▶ Test 2: Enhanced addTenantSchema');
{
  const tenantPayload = {
    name: 'Rahul Sharma',
    phone: '9876543210',
    email: 'rahul.sharma@example.com',
    joinDate: '2026-10-01',
    monthlyRent: 8000,
    securityDeposit: 16000,
    profession: 'working_professional',
    lockInPeriodMonths: 3,
    rentCycle: 'custom',
    billingDate: 15,
  };
  const parsed = addTenantSchema.parse(tenantPayload);
  assert.strictEqual(parsed.profession, 'working_professional');
  assert.strictEqual(parsed.lockInPeriodMonths, 3);
  assert.strictEqual(parsed.rentCycle, 'custom');
  assert.strictEqual(parsed.billingDate, 15);

  // Invalid phone number should fail
  assert.throws(() => {
    addTenantSchema.parse({ ...tenantPayload, phone: '12345' });
  }, /Invalid Indian mobile number/);

  console.log('  ✅ addTenantSchema passed with profession, lockIn, custom billing');
}

// ─── Test 3: Rent Record Update & Reminder Schemas ──────────────────────────
console.log('\n▶ Test 3: updateRentRecordSchema & sendReminderSchema');
{
  const updatePayload = {
    rentAmount: 8500,
    lateFee: 200,
    discount: 500,
    additionalCharges: [{ description: 'Electricity', amount: 450 }],
    status: 'partial',
    notes: 'Partial payment made in cash',
  };
  const parsedUpdate = updateRentRecordSchema.parse(updatePayload);
  assert.strictEqual(parsedUpdate.rentAmount, 8500);
  assert.strictEqual(parsedUpdate.additionalCharges.length, 1);

  const reminderPayload = {
    channel: 'whatsapp',
    type: 'due_reminder',
  };
  const parsedReminder = sendReminderSchema.parse(reminderPayload);
  assert.strictEqual(parsedReminder.channel, 'whatsapp');

  console.log('  ✅ updateRentRecordSchema & sendReminderSchema passed');
}

// ─── Test 4: refundPaymentSchema & createPaymentLinkSchema ──────────────────
console.log('\n▶ Test 4: refundPaymentSchema & createPaymentLinkSchema');
{
  const refundPayload = { amount: 5000, reason: 'Security deposit partial refund' };
  const parsedRefund = refundPaymentSchema.parse(refundPayload);
  assert.strictEqual(parsedRefund.amount, 5000);

  const linkPayload = {
    amount: 7500,
    description: 'October Rent',
    sendWhatsApp: true,
    sendEmail: false,
  };
  const parsedLink = createPaymentLinkSchema.parse(linkPayload);
  assert.strictEqual(parsedLink.amount, 7500);
  assert.strictEqual(parsedLink.sendWhatsApp, true);

  console.log('  ✅ refundPaymentSchema & createPaymentLinkSchema passed');
}

// ─── Test 5: WhatsApp Phone Number Formatting ───────────────────────────────
console.log('\n▶ Test 5: WhatsApp Service Phone Number Formatting');
{
  assert.strictEqual(formatPhoneNumber('9876543210'), '919876543210');
  assert.strictEqual(formatPhoneNumber('+91 98765 43210'), '919876543210');
  assert.strictEqual(formatPhoneNumber('09876543210'), '919876543210');
  assert.strictEqual(formatPhoneNumber('919876543210'), '919876543210');

  assert.strictEqual(TEMPLATES.RENT_REMINDER, 'rent_reminder');
  assert.strictEqual(TEMPLATES.RENT_RECEIPT, 'rent_receipt');

  console.log('  ✅ WhatsApp phone formatting handles all Indian phone variants');
}

// ─── Test 6: Transactional Email HTML Generators ────────────────────────────
console.log('\n▶ Test 6: Transactional Email HTML Generators');
{
  const reminderHtml = buildRentReminderHtml({
    tenantName: 'Priya Patel',
    amount: 9000,
    dueDate: '5 Oct 2026',
    billingMonth: 10,
    billingYear: 2026,
    paymentLink: 'https://rzp.io/l/xyz123',
    pgName: 'Serene Co-Living',
  });
  assert(reminderHtml.includes('Priya Patel'));
  assert(reminderHtml.includes('9,000'));
  assert(reminderHtml.includes('Serene Co-Living'));
  assert(reminderHtml.includes('https://rzp.io/l/xyz123'));

  const paymentHtml = buildPaymentConfirmationHtml({
    tenantName: 'Amit Verma',
    amount: 8500,
    billingMonth: 10,
    billingYear: 2026,
    receiptNumber: 'REC-202610-001',
    receiptUrl: 'https://cloudinary.com/rec.pdf',
    pgName: 'Starlight PG',
  });
  assert(paymentHtml.includes('Amit Verma'));
  assert(paymentHtml.includes('REC-202610-001'));
  assert(paymentHtml.includes('https://cloudinary.com/rec.pdf'));

  const welcomeHtml = buildWelcomeTenantHtml({
    tenantName: 'Deepak Joshi',
    pgName: 'Comfort Living',
    roomNumber: '204',
    bedLabel: 'B',
    rentAmount: 7000,
    securityDeposit: 14000,
    joinDate: '1 Oct 2026',
  });
  assert(welcomeHtml.includes('Deepak Joshi'));
  assert(welcomeHtml.includes('204'));
  assert(welcomeHtml.includes('Comfort Living'));

  console.log('  ✅ Beautiful transactional email HTML templates render correctly');
}

console.log('\n🎉 ALL 6 BACKEND TEST SUITES PASSED FLAWLESSLY!\n');
process.exit(0);

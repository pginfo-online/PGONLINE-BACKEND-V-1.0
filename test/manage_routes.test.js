const assert = require('assert');
const router = require('../src/routes/v1/manage.routes');

console.log('🧪 Inspecting Registered Routes in manage.routes.js...\n');

const routes = [];
router.stack.forEach((middleware) => {
  if (middleware.route) {
    const methods = Object.keys(middleware.route.methods).join(',').toUpperCase();
    routes.push({ path: middleware.route.path, methods });
  }
});

console.log(`Total routes registered: ${routes.length}`);

// Verify all critical new endpoints exist in the route stack
const expectedEndpoints = [
  { path: '/pgs/:pgId/dashboard', method: 'GET' },
  { path: '/pgs/:pgId/rooms', method: 'GET' },
  { path: '/pgs/:pgId/rooms', method: 'POST' },
  { path: '/rent/:id', method: 'GET' },
  { path: '/rent/:id', method: 'PUT' },
  { path: '/rent/:id', method: 'DELETE' },
  { path: '/rent/:id/send-reminder', method: 'POST' },
  { path: '/rent/:id/payment-link', method: 'POST' },
  { path: '/rent/:id/reminders', method: 'GET' },
  { path: '/pgs/:pgId/rent/summary', method: 'GET' },
  { path: '/payments/:id/refund', method: 'POST' },
  { path: '/payments/:id/receipt', method: 'GET' },
  { path: '/payments/create-link', method: 'POST' },
  { path: '/expenses/:id', method: 'GET' },
  { path: '/expenses/:id/approve', method: 'POST' },
  { path: '/expenses/:id/reject', method: 'POST' },
  { path: '/expenses/:id/receipt', method: 'POST' },
  { path: '/pgs/:pgId/expenses/summary', method: 'GET' },
];

for (const exp of expectedEndpoints) {
  const match = routes.find((r) => r.path === exp.path && r.methods.includes(exp.method));
  assert(match, `Missing endpoint: ${exp.method} ${exp.path}`);
  console.log(`  ✅ ${exp.method.padEnd(6)} ${exp.path}`);
}

console.log('\n🎉 ALL EXPECTED PRODUCTION ENDPOINTS ARE PROPERLY REGISTERED!\n');
process.exit(0);

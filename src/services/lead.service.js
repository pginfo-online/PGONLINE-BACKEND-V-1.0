const Lead = require('../models/Lead.model');
const PG = require('../models/PG.model');

/**
 * Add or toggle a lead (inquiry or wishlist)
 */
const addLead = async (pgId, tenantId, type, message) => {
  // Check PG exists
  const pg = await PG.findById(pgId);
  if (!pg) {
    const err = new Error('PG not found');
    err.statusCode = 404;
    throw err;
  }

  // Upsert lead
  const existing = await Lead.findOne({ pg: pgId, tenant: tenantId, type });

  if (existing) {
    // If wishlist, toggle (remove)
    if (type === 'wishlist') {
      await Lead.deleteOne({ _id: existing._id });
      return { action: 'removed', lead: null };
    }
    return { action: 'exists', lead: existing };
  }

  const lead = await Lead.create({ pg: pgId, tenant: tenantId, type, message });

  // Increment inquiries count on PG
  if (type === 'inquiry') {
    await PG.findByIdAndUpdate(pgId, { $inc: { inquiries: 1 } });
  }

  return { action: 'created', lead };
};

/**
 * Get tenant's wishlist
 */
const getTenantLeads = async (tenantId, type) => {
  const query = { tenant: tenantId };
  if (type) query.type = type;

  return Lead.find(query)
    .populate('pg', 'name city area rent photos isVerified status isAvailable')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Get leads for a specific PG (owner view)
 */
const getPGLeads = async (pgId, ownerId) => {
  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) {
    const err = new Error('PG not found or not authorized');
    err.statusCode = 403;
    throw err;
  }

  return Lead.find({ pg: pgId })
    .populate('tenant', 'name email phone')
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Mark leads as read
 */
const markLeadsRead = async (pgId) => {
  return Lead.updateMany({ pg: pgId, isRead: false }, { isRead: true });
};

module.exports = { addLead, getTenantLeads, getPGLeads, markLeadsRead };

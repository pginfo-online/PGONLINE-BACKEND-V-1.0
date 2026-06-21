const PG = require('../models/PG.model');

/**
 * Build MongoDB query from search params
 */
const buildSearchQuery = (params) => {
  const query = { status: 'approved' };

  if (params.city) query.city = params.city;
  if (params.area) query.area = { $regex: params.area, $options: 'i' };
  if (params.food) query.food = params.food;
  if (params.ac !== undefined) query.ac = params.ac === 'true';
  if (params.gender) query.gender = { $in: [params.gender, 'any'] };
  if (params.isVerified !== undefined) query.isVerified = params.isVerified === 'true';

  // Rent range filter
  if (params.minRent !== undefined || params.maxRent !== undefined) {
    const rentCondition = {};
    
    // Parse numeric values safely
    const parseRent = (val) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const num = parseInt(val.replace(/\D/g, ''), 10);
        return isNaN(num) ? undefined : num;
      }
      return undefined;
    };

    const min = parseRent(params.minRent);
    const max = parseRent(params.maxRent);

    if (min !== undefined) rentCondition.$gte = min;
    if (max !== undefined) rentCondition.$lte = max;

    if (params.sharingType === 'single') query['rent.single'] = rentCondition;
    else if (params.sharingType === 'double') query['rent.double'] = rentCondition;
    else if (params.sharingType === 'triple') query['rent.triple'] = rentCondition;
    else {
      query.$or = [
        { 'rent.single': rentCondition },
        { 'rent.double': rentCondition },
        { 'rent.triple': rentCondition },
      ];
    }
  }

  // Text search
  if (params.q) {
    query.$text = { $search: params.q };
  }

  return query;
};

/**
 * Build sort object
 */
const buildSort = (sort) => {
  switch (sort) {
    case 'rent_asc': return { 'rent.single': 1 };
    case 'rent_desc': return { 'rent.single': -1 };
    case 'popular': return { views: -1, inquiries: -1 };
    default: return { createdAt: -1 };
  }
};

/**
 * Get paginated PG listings
 */
const getPGs = async (params) => {
  const query = buildSearchQuery(params);
  const sort = buildSort(params.sort);
  const page = params.page || 1;
  const limit = params.limit || 12;
  const skip = (page - 1) * limit;

  const [pgs, total] = await Promise.all([
    PG.find(query)
      .populate('owner', 'name email phone')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    PG.countDocuments(query),
  ]);

  return {
    pgs,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
};

/**
 * Get single PG by ID (increment view count)
 */
const getPGById = async (id) => {
  const pg = await PG.findByIdAndUpdate(
    id,
    { $inc: { views: 1 } },
    { new: true }
  ).populate('owner', 'name email phone');

  if (!pg) {
    const err = new Error('PG not found');
    err.statusCode = 404;
    throw err;
  }

  return pg;
};

/**
 * Create a new PG listing
 */
const createPG = async (ownerId, data) => {
  return PG.create({ ...data, owner: ownerId, status: 'pending' });
};

/**
 * Update a PG listing (owner must own it)
 */
const updatePG = async (pgId, ownerId, data) => {
  const pg = await PG.findOne({ _id: pgId, owner: ownerId });
  if (!pg) {
    const err = new Error('PG not found or you are not the owner');
    err.statusCode = 404;
    throw err;
  }

  Object.assign(pg, data);
  await pg.save();
  return pg;
};

/**
 * Delete a PG listing
 */
const deletePG = async (pgId, userId, role) => {
  const query = role === 'admin' ? { _id: pgId } : { _id: pgId, owner: userId };
  const pg = await PG.findOneAndDelete(query);

  if (!pg) {
    const err = new Error('PG not found or not authorized');
    err.statusCode = 404;
    throw err;
  }

  return pg;
};

/**
 * AI-based search — extract params from NL intent
 */
const aiSearchPGs = async (intentParams) => {
  const query = buildSearchQuery(intentParams);
  return PG.find(query)
    .populate('owner', 'name phone')
    .sort({ isVerified: -1, createdAt: -1 })
    .limit(10)
    .lean();
};

/**
 * Get real-time autocomplete suggestions for search
 */
const getSuggestions = async (query) => {
  if (!query || query.length < 2) return { suggestions: [] };

  const regex = new RegExp(query, 'i');

  // Search by name and area
  const pgs = await PG.find({
    $or: [
      { name: regex },
      { area: regex }
    ],
    status: 'approved'
  })
    .select('name area city')
    .limit(10)
    .lean();

  const suggestionsMap = new Map();

  pgs.forEach(pg => {
    // Check if area matches
    if (regex.test(pg.area)) {
      const key = `area:${pg.area}`;
      if (!suggestionsMap.has(key)) {
        suggestionsMap.set(key, { text: pg.area, type: 'area', city: pg.city });
      }
    }
    // Check if name matches
    if (regex.test(pg.name)) {
      const key = `pg_name:${pg.name}`;
      if (!suggestionsMap.has(key)) {
        suggestionsMap.set(key, { text: pg.name, type: 'pg_name', pgId: pg._id });
      }
    }
  });

  return { suggestions: Array.from(suggestionsMap.values()).slice(0, 10) };
};

module.exports = { getPGs, getPGById, createPG, updatePG, deletePG, aiSearchPGs, buildSearchQuery, getSuggestions };

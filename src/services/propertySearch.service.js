const Property = require('../models/Property.model');

/**
 * Escape special regex characters
 */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const safeRegex = (str, flags = 'i') => new RegExp(escapeRegex(str), flags);

/**
 * Build MongoDB match query from multi-category search params
 */
const buildPropertySearchQuery = (params) => {
  const query = {};

  // Status constraint — defaults to approved for public discovery
  if (params.status && params.status !== 'all') {
    query.status = params.status;
  } else {
    query.status = 'approved';
  }

  // Category filter
  if (params.category && params.category !== 'all') {
    query.category = params.category;
  }

  // Purpose filter (rent vs sale)
  if (params.purpose && params.purpose !== 'all') {
    query.purpose = params.purpose;
  }

  // Location filters
  if (params.city && params.city.trim()) {
    query.city = safeRegex(params.city.trim());
  }

  if (params.areas) {
    const areaList = String(params.areas)
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (areaList.length > 0) {
      query.area = { $in: areaList.map((a) => safeRegex(a)) };
    }
  } else if (params.area && params.area.trim()) {
    query.area = safeRegex(params.area.trim());
  }

  // Price range filters
  const priceFilter = {};
  if (params.minPrice !== undefined && params.minPrice !== null && !isNaN(Number(params.minPrice))) {
    priceFilter.$gte = Number(params.minPrice);
  }
  if (params.maxPrice !== undefined && params.maxPrice !== null && !isNaN(Number(params.maxPrice))) {
    priceFilter.$lte = Number(params.maxPrice);
  }
  if (Object.keys(priceFilter).length > 0) {
    query['pricing.expectedPrice'] = priceFilter;
  }

  // Verified & Featured filters
  if (params.isVerified !== undefined && params.isVerified !== '') {
    query.isVerified = params.isVerified === 'true' || params.isVerified === true;
  }
  if (params.isFeatured !== undefined && params.isFeatured !== '') {
    query.isFeatured = params.isFeatured === 'true' || params.isFeatured === true;
  }

  // ── Category-Specific Faceted Filters ──────────────────────────────────────

  // 1. Residential Rental specifics
  if (params.bhk) {
    const bhkList = String(params.bhk).split(',').map((b) => b.trim()).filter(Boolean);
    if (bhkList.length === 1) {
      query['residentialDetails.bhk'] = bhkList[0];
    } else if (bhkList.length > 1) {
      query['residentialDetails.bhk'] = { $in: bhkList };
    }
  }

  if (params.furnishingStatus) {
    query['residentialDetails.furnishingStatus'] = params.furnishingStatus;
  }

  if (params.residentialSubtype) {
    query['residentialDetails.propertySubtype'] = params.residentialSubtype;
  }

  // 2. Commercial specifics
  if (params.commercialSubtype) {
    const subList = String(params.commercialSubtype).split(',').map((s) => s.trim()).filter(Boolean);
    if (subList.length === 1) {
      query['commercialDetails.commercialSubtype'] = subList[0];
    } else if (subList.length > 1) {
      query['commercialDetails.commercialSubtype'] = { $in: subList };
    }
  }

  if (params.fitoutStatus) {
    query['commercialDetails.fitoutStatus'] = params.fitoutStatus;
  }

  // 3. PG specifics
  if (params.gender && params.gender !== 'any') {
    query['pgDetails.gender'] = { $in: [params.gender, 'any'] };
  }

  if (params.food && params.food !== 'any') {
    query['pgDetails.food'] = params.food;
  }

  if (params.ac !== undefined && params.ac !== '') {
    query['pgDetails.ac'] = params.ac === 'true' || params.ac === true;
  }

  if (params.sharingType) {
    query['pgDetails.roomConfigs.shareType'] = params.sharingType;
  }

  // ── Text Search ─────────────────────────────────────────────────────────────
  if (params.q && params.q.trim()) {
    const qRegex = safeRegex(params.q.trim(), 'i');
    const textConditions = [
      { title: qRegex },
      { area: qRegex },
      { city: qRegex },
      { address: qRegex },
      { fullAddress: qRegex },
      { landmark: qRegex },
      { description: qRegex },
      { 'residentialDetails.societyName': qRegex },
      { 'nearbyPlaces.name': qRegex },
    ];

    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: textConditions }];
      delete query.$or;
    } else {
      query.$or = textConditions;
    }
  }

  return query;
};

/**
 * Build sort object
 */
const buildPropertySort = (sort) => {
  switch (sort) {
    case 'price_asc':  return { 'pricing.expectedPrice': 1, createdAt: -1 };
    case 'price_desc': return { 'pricing.expectedPrice': -1, createdAt: -1 };
    case 'popular':    return { views: -1, inquiries: -1 };
    case 'newest':     return { createdAt: -1 };
    default:           return { isFeatured: -1, createdAt: -1 };
  }
};

/**
 * In-memory suggestion cache (5 min TTL)
 */
const _suggestionsCache = new Map();
const SUGGESTIONS_CACHE_TTL = 5 * 60 * 1000;

const searchProperties = async (params = {}) => {
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(params.limit, 10) || 12));
  const skip = (page - 1) * limit;

  const hasGeo =
    params.lat != null &&
    params.lng != null &&
    !isNaN(Number(params.lat)) &&
    !isNaN(Number(params.lng));

  // If geo coordinates and radius are passed, use $geoNear aggregation pipeline
  if (hasGeo) {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    const maxDistanceMeters = (Math.max(1, Number(params.radius) || 10)) * 1000; // default 10km

    const matchQuery = buildPropertySearchQuery(params);

    const pipeline = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distance',
          maxDistance: maxDistanceMeters,
          spherical: true,
          query: matchQuery,
        },
      },
      { $sort: { distance: 1 } },
      {
        $facet: {
          properties: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: 'users',
                localField: 'owner',
                foreignField: '_id',
                as: 'owner',
              },
            },
            { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                'owner.password': 0,
                'owner.tokens': 0,
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await Property.aggregate(pipeline);
    const properties = result?.properties || [];
    const total = result?.totalCount?.[0]?.count || 0;

    return {
      properties,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  // Standard indexed query
  const query = buildPropertySearchQuery(params);
  const sort = buildPropertySort(params.sort);

  const [properties, total] = await Promise.all([
    Property.find(query)
      .populate('owner', 'name email phone profilePhoto')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Property.countDocuments(query),
  ]);

  return {
    properties,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
};

/**
 * Autocomplete search suggestions
 */
const getPropertySuggestions = async (q = '', sessiontoken = '') => {
  if (!q || q.trim().length < 2) return [];

  const clean = q.trim().toLowerCase();
  const cached = _suggestionsCache.get(clean);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const regex = safeRegex(clean);
  const properties = await Property.find({
    status: 'approved',
    $or: [{ title: regex }, { area: regex }, { city: regex }],
  })
    .select('title area city category purpose pricing.expectedPrice photos')
    .limit(8)
    .lean();

  const suggestions = properties.map((p) => ({
    id: p._id,
    title: p.title,
    area: p.area,
    city: p.city,
    category: p.category,
    purpose: p.purpose,
    price: p.pricing?.expectedPrice,
    image: p.photos?.[0]?.url || null,
  }));

  _suggestionsCache.set(clean, { data: suggestions, expiresAt: Date.now() + SUGGESTIONS_CACHE_TTL });
  return suggestions;
};

module.exports = {
  searchProperties,
  buildPropertySearchQuery,
  getPropertySuggestions,
};

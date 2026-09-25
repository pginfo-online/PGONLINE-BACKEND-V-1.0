const Property = require('../models/Property.model');
require('../models/User.model'); // ensure User schema is registered for populate('owner')

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

  // Category filter / propertyType synonym
  if (params.category && params.category !== 'all') {
    query.category = params.category;
  } else if (params.propertyType) {
    const pt = String(params.propertyType).toLowerCase();
    if (pt === 'pg' || pt === 'hostel' || pt === 'co-living') {
      query.category = 'pg';
    } else if (pt === 'commercial' || pt === 'commercials') {
      query.category = 'commercial';
    } else if (pt === 'residential_rental' || pt === 'rented_flats' || pt === 'flats' || pt === 'apartment') {
      query.category = 'residential_rental';
    }
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

  // Price range filters (supports minPrice / minRent, maxPrice / maxRent)
  const minPrice = params.minPrice !== undefined && params.minPrice !== null ? params.minPrice : params.minRent;
  const maxPrice = params.maxPrice !== undefined && params.maxPrice !== null ? params.maxPrice : params.maxRent;
  const priceFilter = {};
  if (minPrice !== undefined && minPrice !== null && !isNaN(Number(minPrice))) {
    priceFilter.$gte = Number(minPrice);
  }
  if (maxPrice !== undefined && maxPrice !== null && !isNaN(Number(maxPrice))) {
    priceFilter.$lte = Number(maxPrice);
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
 * Build sort object (supports both price_asc/desc and rent_asc/desc)
 */
const buildPropertySort = (sort) => {
  switch (sort) {
    case 'price_asc':
    case 'rent_asc':
      return { 'pricing.expectedPrice': 1, createdAt: -1 };
    case 'price_desc':
    case 'rent_desc':
      return { 'pricing.expectedPrice': -1, createdAt: -1 };
    case 'popular':
      return { views: -1, inquiries: -1 };
    case 'newest':
      return { createdAt: -1 };
    default:
      return { isFeatured: -1, createdAt: -1 };
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

  const lat = Number(params.lat);
  const lng = Number(params.lng);
  const hasGeo =
    params.lat != null &&
    params.lng != null &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180;

  // If geo coordinates and radius are passed, use $geoNear aggregation pipeline
  if (hasGeo) {
    try {
      const maxDistanceMeters = Math.min(50, Math.max(1, Number(params.radius) || 10)) * 1000;

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
      const rawProperties = result?.properties || [];
      const total = result?.totalCount?.[0]?.count || 0;

      const properties = rawProperties.map((p) => ({
        ...p,
        distanceKm: p.distance != null ? Math.round((p.distance / 1000) * 10) / 10 : undefined,
      }));

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
    } catch (geoErr) {
      console.warn('[propertySearch] $geoNear failed, falling back to standard indexed query:', geoErr.message);
      // Fall through to standard indexed query
    }
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

  const normalizedProperties = properties.map((p) => {
    if (p.category === 'pg' || p.pgDetails) {
      const roomConfigs = p.pgDetails?.roomConfigs || [];
      let minRent = p.pricing?.expectedPrice;
      if (roomConfigs.length > 0) {
        const rents = roomConfigs.map((rc) => Number(rc.rent)).filter((r) => !isNaN(r) && r > 0);
        if (rents.length > 0) minRent = Math.min(...rents);
      }
      return {
        ...p,
        name: p.title || p.name,
        facilities: p.amenities || p.facilities || [],
        amenities: p.amenities || p.facilities || [],
        roomConfigs,
        minRent: minRent ?? p.pricing?.expectedPrice ?? 0,
        gender: p.pgDetails?.gender || 'any',
        food: p.pgDetails?.food || 'none',
        foodIncluded: p.pgDetails?.foodIncluded ?? false,
        foodInfo: p.pgDetails?.foodInfo || {},
        rules: p.pgDetails?.rules || {},
        securityDeposit: p.pricing?.securityDeposit ?? roomConfigs[0]?.depositAmount ?? 0,
        noticePeriod: p.pgDetails?.noticePeriod ?? 30,
        minStay: p.pgDetails?.minStay ?? 1,
        isAvailable: p.pgDetails?.isAvailable ?? true,
        propertyType: p.pgDetails?.propertySubtype || 'PG',
      };
    }
    return {
      ...p,
      name: p.title || p.name,
      facilities: p.amenities || p.facilities || [],
      amenities: p.amenities || p.facilities || [],
    };
  });

  return {
    properties: normalizedProperties,
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
 * Autocomplete search suggestions (returns both matching areas & properties)
 */
const getPropertySuggestions = async (q = '', sessiontoken = '') => {
  if (!q || q.trim().length < 2) return [];

  const clean = q.trim().toLowerCase();
  const cached = _suggestionsCache.get(clean);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const regex = safeRegex(clean);
  const Area = require('../models/Area.model');

  // Search matching areas and properties in parallel
  const [matchingAreas, matchingProps] = await Promise.allSettled([
    Area.find({ isActive: true, name: regex })
      .select('_id name cityName city')
      .populate('city', 'name')
      .limit(4)
      .lean(),
    Property.find({
      status: 'approved',
      $or: [{ title: regex }, { area: regex }, { city: regex }],
    })
      .select('title area city category purpose pricing.expectedPrice photos')
      .limit(8)
      .lean(),
  ]);

  const suggestions = [];
  const seenTexts = new Set();

  // 1. Add area suggestions first
  if (matchingAreas.status === 'fulfilled' && Array.isArray(matchingAreas.value)) {
    for (const a of matchingAreas.value) {
      const areaName = (a.name || '').trim();
      const norm = areaName.toLowerCase();
      if (!seenTexts.has(norm)) {
        seenTexts.add(norm);
        const cityName = a.city?.name || a.cityName || '';
        suggestions.push({
          id: a._id,
          name: areaName,
          text: areaName,
          title: areaName,
          type: 'area',
          area: areaName,
          city: cityName,
          category: 'all',
          subtext: cityName ? `Locality in ${cityName}` : 'Locality',
        });
      }
    }
  }

  // 2. Add property suggestions
  if (matchingProps.status === 'fulfilled' && Array.isArray(matchingProps.value)) {
    for (const p of matchingProps.value) {
      const title = (p.title || '').trim();
      const norm = title.toLowerCase();
      if (!seenTexts.has(norm)) {
        seenTexts.add(norm);
        const isPG = p.category === 'pg';
        suggestions.push({
          id: p._id,
          pgId: isPG ? p._id : undefined,
          propertyId: p._id,
          name: title,
          text: title,
          title,
          type: isPG ? 'pg_name' : 'property_name',
          area: p.area,
          city: p.city,
          category: p.category,
          purpose: p.purpose,
          price: p.pricing?.expectedPrice,
          image: p.photos?.[0]?.url || null,
          subtext: `${p.area ? `${p.area}, ` : ''}${p.city || ''}`,
        });
      }
    }
  }

  const finalSuggestions = suggestions.slice(0, 10);
  _suggestionsCache.set(clean, { data: finalSuggestions, expiresAt: Date.now() + SUGGESTIONS_CACHE_TTL });
  return finalSuggestions;
};

module.exports = {
  searchProperties,
  buildPropertySearchQuery,
  getPropertySuggestions,
};

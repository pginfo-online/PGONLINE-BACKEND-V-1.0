const crypto = require('crypto');
const Property = require('../models/Property.model');
const Area = require('../models/Area.model');
const City = require('../models/City.model');
require('../models/User.model'); // ensure User schema is registered for populate('owner')
const redisCache = require('./redisCache.service');
const { logger } = require('../utils/logger');

/**
 * Escape special regex characters safely
 */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const safeRegex = (str, flags = 'i') => new RegExp(escapeRegex(str), flags);

/**
 * Optimized Cloudinary URL transformer
 * Injects thumbnail dimensions and modern web delivery (q_auto, f_auto)
 */
const getCloudinaryThumbnail = (url, width = 640, height = 480) => {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {
    if (!url.includes('/upload/w_') && !url.includes('/upload/c_')) {
      return url.replace('/upload/', `/upload/w_${width},h_${height},c_fill,q_auto,f_auto/`);
    }
  }
  return url;
};

/**
 * Generate a deterministic MD5 hash for search query caching
 */
const getSearchCacheKey = (params) => {
  const cleanParams = {};
  const relevantKeys = [
    'category', 'propertyType', 'city', 'area', 'areas', 'q',
    'minPrice', 'maxPrice', 'minRent', 'maxRent', 'sort', 'page', 'limit',
    'gender', 'food', 'ac', 'bhk', 'commercialSubtype', 'sharingType',
    'isVerified', 'isFeatured', 'purpose', 'furnishingStatus', 'fitoutStatus'
  ];
  for (const k of relevantKeys.sort()) {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
      cleanParams[k] = String(params[k]).trim();
    }
  }
  const hash = crypto.createHash('md5').update(JSON.stringify(cleanParams)).digest('hex');
  return `search:properties:${hash}`;
};

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

  // Price range filters
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
 * Normalize and enrich property objects for listing presentation
 */
const normalizePropertyForListing = (p) => {
  const photos = Array.isArray(p.photos)
    ? p.photos.map((ph) => {
        const rawUrl = typeof ph === 'string' ? ph : ph?.url || '';
        return {
          url: rawUrl,
          thumbnailUrl: getCloudinaryThumbnail(rawUrl),
          publicId: ph?.publicId || '',
          isMain: Boolean(ph?.isMain),
        };
      })
    : [];

  const base = {
    _id: p._id,
    id: p._id,
    title: p.title || p.name || 'Property',
    name: p.title || p.name || 'Property',
    category: p.category || 'pg',
    purpose: p.purpose || 'rent',
    city: p.city || '',
    area: p.area || '',
    address: p.address || '',
    landmark: p.landmark || '',
    isVerified: Boolean(p.isVerified),
    isFeatured: Boolean(p.isFeatured),
    photos,
    facilities: p.amenities || p.facilities || [],
    amenities: p.amenities || p.facilities || [],
    pricing: p.pricing || { expectedPrice: 0 },
    distanceKm: p.distanceKm,
    owner: p.owner ? {
      _id: p.owner._id,
      name: p.owner.name,
      phone: p.owner.phone,
      email: p.owner.email,
      profilePhoto: p.owner.profilePhoto,
    } : null,
    contactPhone: p.contactPhone || p.owner?.phone,
    contactWhatsapp: p.contactWhatsapp || p.contactPhone || p.owner?.phone,
  };

  if (p.category === 'pg' || p.pgDetails) {
    const roomConfigs = p.pgDetails?.roomConfigs || [];
    let minRent = p.pricing?.expectedPrice;
    if (roomConfigs.length > 0) {
      const rents = roomConfigs.map((rc) => Number(rc.rent)).filter((r) => !isNaN(r) && r > 0);
      if (rents.length > 0) minRent = Math.min(...rents);
    }
    return {
      ...base,
      pgDetails: p.pgDetails || {},
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

  if (p.category === 'residential_rental' || p.residentialDetails) {
    return {
      ...base,
      residentialDetails: p.residentialDetails || {},
      minRent: p.pricing?.expectedPrice ?? 0,
      bhk: p.residentialDetails?.bhk || '',
      furnishingStatus: p.residentialDetails?.furnishingStatus || '',
      propertyType: p.residentialDetails?.propertySubtype || 'Apartment',
    };
  }

  if (p.category === 'commercial' || p.commercialDetails) {
    return {
      ...base,
      commercialDetails: p.commercialDetails || {},
      minRent: p.pricing?.expectedPrice ?? 0,
      commercialSubtype: p.commercialDetails?.commercialSubtype || 'Commercial',
      carpetAreaSqFt: p.commercialDetails?.carpetAreaSqFt,
      propertyType: p.commercialDetails?.commercialSubtype || 'Commercial',
    };
  }

  return base;
};

/**
 * Execute property search with Redis caching & database fallback
 */
const searchProperties = async (params = {}) => {
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(params.limit, 10) || 12));
  const skip = (page - 1) * limit;

  // Check Redis cache for standard searches (first 5 pages)
  const isCacheable = !params.lat && !params.lng && page <= 5;
  const cacheKey = isCacheable ? getSearchCacheKey({ ...params, page, limit }) : null;

  if (cacheKey) {
    const cached = await redisCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const lat = Number(params.lat);
  const lng = Number(params.lng);
  const hasGeo =
    params.lat != null &&
    params.lng != null &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180;

  // Geo search pipeline
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

      const properties = rawProperties.map((p) =>
        normalizePropertyForListing({
          ...p,
          distanceKm: p.distance != null ? Math.round((p.distance / 1000) * 10) / 10 : undefined,
        })
      );

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
      logger.warn(`[propertySearch] $geoNear failed, falling back to standard indexed query: ${geoErr.message}`);
    }
  }

  // Standard indexed query with field projection for high throughput
  const query = buildPropertySearchQuery(params);
  const sort = buildPropertySort(params.sort);

  const [rawProperties, total] = await Promise.all([
    Property.find(query)
      .select(
        'title name area city category purpose pricing photos pgDetails residentialDetails commercialDetails isVerified isFeatured address landmark owner createdAt contactPhone contactWhatsapp monthlyPricing depositAmount'
      )
      .populate('owner', 'name email phone profilePhoto')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Property.countDocuments(query),
  ]);

  const properties = rawProperties.map(normalizePropertyForListing);

  const responseData = {
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

  // Cache in Redis for 180 seconds (3 mins) for rapid repeated searches
  if (cacheKey) {
    redisCache.set(cacheKey, responseData, 180).catch(() => {});
  }

  return responseData;
};

/**
 * Autocomplete search suggestions
 * Supports:
 * - Scoping to city (Pune, Bengaluru, etc.)
 * - Redis caching (600s TTL)
 * - Exact vs Prefix vs Substring ranking
 * - Structured hierarchy: Locality -> Area -> Property
 */
const getPropertySuggestions = async (qOrOptions = '', legacySessionToken = '') => {
  let q = '';
  let city = '';
  let cityId = '';
  let category = '';

  if (typeof qOrOptions === 'object' && qOrOptions !== null) {
    q = qOrOptions.q || '';
    city = qOrOptions.city || '';
    cityId = qOrOptions.cityId || '';
    category = qOrOptions.category || '';
  } else {
    q = String(qOrOptions || '');
  }

  if (!q || q.trim().length < 2) return [];

  const cleanQ = q.trim().toLowerCase();
  const cleanCity = (city || '').trim().toLowerCase();
  const cleanCategory = (category || '').trim().toLowerCase();

  const cacheKey = `search:suggest:${cleanCity || 'all'}:${cleanCategory || 'all'}:${cleanQ}`;
  const cached = await redisCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const regex = safeRegex(cleanQ);

  // 1. Resolve city filter for Area search
  const areaFilter = { isActive: true, name: regex };
  if (cityId) {
    areaFilter.city = cityId;
  } else if (cleanCity) {
    areaFilter.cityName = safeRegex(cleanCity);
  }

  // 2. Resolve property filter
  const propFilter = {
    status: 'approved',
    $or: [{ title: regex }, { area: regex }, { landmark: regex }],
  };
  if (cleanCity) {
    propFilter.city = safeRegex(cleanCity);
  }
  if (cleanCategory && cleanCategory !== 'all') {
    propFilter.category = cleanCategory;
  }

  // Parallel search in Area and Property models
  const [matchingAreas, matchingProps] = await Promise.allSettled([
    Area.find(areaFilter)
      .select('_id name cityName city order isAutoCreated')
      .populate('city', 'name')
      .limit(6)
      .lean(),
    Property.find(propFilter)
      .select('title name area city category purpose pricing.expectedPrice photos isVerified')
      .limit(8)
      .lean(),
  ]);

  const suggestions = [];
  const seenTexts = new Set();

  // Helper to score match relevance: Exact (100) > Prefix (50) > Substring (10)
  const getMatchScore = (targetText) => {
    const t = (targetText || '').trim().toLowerCase();
    if (t === cleanQ) return 100;
    if (t.startsWith(cleanQ)) return 50;
    return 10;
  };

  // 1. Process Area / Locality suggestions
  if (matchingAreas.status === 'fulfilled' && Array.isArray(matchingAreas.value)) {
    const areaResults = [];
    for (const a of matchingAreas.value) {
      const areaName = (a.name || '').trim();
      const norm = areaName.toLowerCase();
      if (!seenTexts.has(norm)) {
        seenTexts.add(norm);
        const cityName = a.city?.name || a.cityName || city || '';
        areaResults.push({
          id: String(a._id),
          name: areaName,
          text: areaName,
          title: areaName,
          type: 'locality',
          area: areaName,
          city: cityName,
          category: 'all',
          subtitle: cityName ? `Locality in ${cityName}` : 'Locality',
          score: getMatchScore(areaName) + 20, // Boost localities above raw property titles
        });
      }
    }
    suggestions.push(...areaResults);
  }

  // 2. Process Property suggestions
  if (matchingProps.status === 'fulfilled' && Array.isArray(matchingProps.value)) {
    const propResults = [];
    for (const p of matchingProps.value) {
      const title = (p.title || p.name || '').trim();
      const norm = title.toLowerCase();
      if (!seenTexts.has(norm)) {
        seenTexts.add(norm);
        const isPG = p.category === 'pg';
        const primaryPhoto = p.photos?.[0]?.url || null;
        propResults.push({
          id: String(p._id),
          pgId: isPG ? String(p._id) : undefined,
          propertyId: String(p._id),
          name: title,
          text: title,
          title,
          type: 'property',
          area: p.area || '',
          city: p.city || '',
          category: p.category,
          purpose: p.purpose,
          price: p.pricing?.expectedPrice,
          image: primaryPhoto ? getCloudinaryThumbnail(primaryPhoto, 200, 200) : null,
          subtitle: `${p.category === 'pg' ? 'PG' : p.category === 'residential_rental' ? 'Flat' : 'Commercial'} in ${p.area || ''}, ${p.city || ''}`,
          isVerified: Boolean(p.isVerified),
          score: getMatchScore(title),
        });
      }
    }
    suggestions.push(...propResults);
  }

  // Sort by score descending
  suggestions.sort((a, b) => b.score - a.score);

  const finalSuggestions = suggestions.slice(0, 10);

  // Cache in Redis for 10 minutes (600 seconds)
  redisCache.set(cacheKey, finalSuggestions, 600).catch(() => {});

  return finalSuggestions;
};

module.exports = {
  searchProperties,
  buildPropertySearchQuery,
  getPropertySuggestions,
  getCloudinaryThumbnail,
};

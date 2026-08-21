const PG = require('../models/PG.model');
const PGUpdateRequest = require('../models/PGUpdateRequest.model');

/**
 * Escape special regular expression characters to prevent syntax errors
 */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const safeRegex = (str, flags = 'i') => new RegExp(escapeRegex(str), flags);

/**
 * Build MongoDB query from search params
 */
const buildSearchQuery = (params) => {
  const query = { status: 'approved' };

  if (params.city) query.city = params.city;

  // Multi-area support: ?areas=Baner,Wakad,Hinjewadi (up to 3)
  if (params.areas) {
    const areaList = String(params.areas)
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (areaList.length > 0) {
      query.area = { $in: areaList.map((a) => safeRegex(a, 'i')) };
    }
  } else if (params.area && params.area.trim()) {
    query.area = { $regex: escapeRegex(params.area.trim()), $options: 'i' };
  }
  if (params.food) query.food = params.food;
  if (params.ac !== undefined) query.ac = params.ac === 'true';
  if (params.gender) query.gender = { $in: [params.gender, 'any'] };
  if (params.isVerified !== undefined) query.isVerified = params.isVerified === 'true';

  // Property type
  if (params.propertyType) query.propertyType = params.propertyType;

  // Rent range and sharing type filter
  if (params.minRent !== undefined || params.maxRent !== undefined || params.sharingType) {
    const rentCondition = {};
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

    const hasRentBounds = min !== undefined || max !== undefined;
    const shareMatch = params.sharingType ? { shareType: params.sharingType, ...(hasRentBounds ? { rent: rentCondition } : {}) } : { rent: rentCondition };

    if (params.sharingType && ['single', 'double', 'triple'].includes(params.sharingType)) {
      const legacyKey = `rent.${params.sharingType}`;
      if (hasRentBounds) {
        query.$or = [
          { [legacyKey]: rentCondition },
          { roomConfigs: { $elemMatch: shareMatch } }
        ];
      } else {
        query.$or = [
          { [legacyKey]: { $exists: true, $ne: null } },
          { roomConfigs: { $elemMatch: shareMatch } }
        ];
      }
    } else {
      query.$or = [
        ...(hasRentBounds ? [
          { 'rent.single': rentCondition },
          { 'rent.double': rentCondition },
          { 'rent.triple': rentCondition }
        ] : []),
        { roomConfigs: { $elemMatch: shareMatch } }
      ];
    }
  }

  // Text search (Resilient substring matching across multiple fields)
  if (params.q && params.q.trim()) {
    const qTerm = params.q.trim();
    const qRegex = safeRegex(qTerm, 'i');
    const textConditions = [
      { name: qRegex },
      { area: qRegex },
      { fullAddress: qRegex },
      { landmark: qRegex },
      { city: qRegex },
    ];
    if (query.$or) {
      query.$and = [
        { $or: query.$or },
        { $or: textConditions },
      ];
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
const buildSort = (sort) => {
  switch (sort) {
    case 'rent_asc': return { 'rent.single': 1, 'roomConfigs.rent': 1 };
    case 'rent_desc': return { 'rent.single': -1, 'roomConfigs.rent': -1 };
    case 'popular': return { views: -1, inquiries: -1 };
    case 'distance': return null; // handled implicitly by $geoNear
    default: return { createdAt: -1 };
  }
};

/**
 * Get paginated PG listings
 */
/**
 * Get paginated PG listings
 */
const getPGs = async (params, user = null) => {
  const query = buildSearchQuery(params);
  const sort = buildSort(params.sort);
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const hasPagination = params.page !== undefined || params.limit !== undefined;
  let limit = Math.max(1, parseInt(params.limit, 10) || (hasPagination ? 12 : 50));
  if (limit > 50) limit = 50;
  const skip = (page - 1) * limit;

  let pgs, total;

  if (params.lat && params.lng) {
    const lat = parseFloat(params.lat);
    const lng = parseFloat(params.lng);
    const radius = parseFloat(params.radius) || 10; // Default 10km

    const geoNearStage = {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance', // will return distance in meters
        maxDistance: radius * 1000,
        query: query,
        spherical: true
      }
    };

    const pipeline = [
      geoNearStage,
      ...(sort ? [{ $sort: sort }] : []),
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'owner',
          foreignField: '_id',
          as: 'owner'
        }
      },
      { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: 1, city: 1, area: 1, address: 1, rent: 1, food: 1, ac: 1, gender: 1, photos: 1, isVerified: 1, isAvailable: 1, status: 1, createdAt: 1, distance: 1, latitude: 1, longitude: 1, location: 1,
          'owner._id': 1, 'owner.name': 1, 'owner.email': 1, 'owner.phone': 1
        }
      }
    ];

    const countPipeline = [
      geoNearStage,
      { $count: 'total' }
    ];

    const [aggResult, countResult] = await Promise.all([
      PG.aggregate(pipeline),
      PG.aggregate(countPipeline)
    ]);

    pgs = aggResult;
    total = countResult.length > 0 ? countResult[0].total : 0;
  } else {
    const [findPgs, findTotal] = await Promise.all([
      PG.find(query)
        .select('name city area address rent food ac gender photos isVerified isAvailable status owner createdAt latitude longitude location')
        .populate('owner', 'name email phone')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      PG.countDocuments(query),
    ]);
    pgs = findPgs;
    total = findTotal;
  }

  // ─── Public Sanitization ───────────────────────────────────────────────────
  const isGuest = !user;
  const sanitizedPgs = pgs.map((item) => {
    const pgObj = { ...item, isPublicPreview: isGuest };
    if (isGuest && pgObj.owner) {
      delete pgObj.owner.email;
      delete pgObj.owner.phone;
    }
    return pgObj;
  });

  return {
    pgs: sanitizedPgs,
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
const getPGById = async (id, user = null) => {
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

  const pgObj = pg.toObject();
  const isGuest = !user;
  pgObj.isPublicPreview = isGuest;

  if (isGuest) {
    // Mask sensitive contact details for unauthenticated public visitors
    if (pgObj.contactPhone) {
      const raw = pgObj.contactPhone.replace(/\D/g, '');
      if (raw.length >= 10) {
        pgObj.contactPhone = `+91 ${raw.slice(0, 2)}******${raw.slice(-2)}`;
      } else {
        pgObj.contactPhone = '+91 ********';
      }
    } else {
      pgObj.contactPhone = '+91 ********';
    }

    delete pgObj.contactWhatsapp;
    delete pgObj.mapsLink;

    if (pgObj.owner) {
      delete pgObj.owner.email;
      delete pgObj.owner.phone;
    }

    // Mask exact address line
    if (pgObj.area && pgObj.city) {
      pgObj.address = `${pgObj.area}, ${pgObj.city} (Exact address unlocked after login)`;
    }
  }

  return pgObj;
};

/**
 * Create a new PG listing
 */
const createPG = async (ownerId, data) => {
  const name = data.name ? data.name.trim() : '';
  const city = data.city;
  const area = data.area ? data.area.trim() : '';
  const address = data.address ? data.address.trim() : '';

  const escapeRegex = (str) => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

  const existingPG = await PG.findOne({
    owner: ownerId,
    name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') },
    city,
    area: { $regex: new RegExp(`^${escapeRegex(area)}$`, 'i') },
    address: { $regex: new RegExp(`^${escapeRegex(address)}$`, 'i') },
    status: { $in: ['pending', 'approved'] },
  });

  if (existingPG) {
    const err = new Error('You have already submitted a PG listing with this name and address.');
    err.statusCode = 400;
    throw err;
  }

  let locationData = {};
  try {
    const { geocodeAddress } = require('../utils/geocoder');
    const fullAddress = `${address}, ${area}, ${city}`;
    const coords = await geocodeAddress(fullAddress);
    if (coords) {
      locationData = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        location: {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude]
        },
        fullAddress: coords.fullAddress,
        postalCode: coords.postalCode,
        country: coords.country,
        state: coords.state,
        district: coords.district,
        googlePlaceId: coords.placeId,
      };
      if (!city && coords.city) locationData.city = coords.city;
    }
  } catch (err) {
    console.error('Geocoding error in createPG:', err);
  }

  const User = require('../models/User.model');
  const pg = await PG.create({
    ...data,
    name,
    area,
    address,
    ...locationData,
    owner: ownerId,
    status: 'pending',
  });

  await User.findByIdAndUpdate(ownerId, { role: 'owner' });

  return pg;
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

  const originalSnapshot = pg.toObject();

  try {
    const { geocodeAddress } = require('../utils/geocoder');
    const fullAddress = `${data.address || pg.address}, ${data.area || pg.area}, ${data.city || pg.city}`;
    const coords = await geocodeAddress(fullAddress);
    if (coords) {
      data.latitude = coords.latitude;
      data.longitude = coords.longitude;
      data.location = {
        type: 'Point',
        coordinates: [coords.longitude, coords.latitude]
      };
      if (coords.fullAddress) data.fullAddress = coords.fullAddress;
      if (coords.postalCode) data.postalCode = coords.postalCode;
      if (coords.country) data.country = coords.country;
      if (coords.state) data.state = coords.state;
      if (coords.district) data.district = coords.district;
      if (coords.placeId) data.googlePlaceId = coords.placeId;
    }
  } catch (err) {
    console.error('Geocoding error in updatePG:', err);
  }

  // Cancel any existing pending or correction_required requests for this PG
  await PGUpdateRequest.updateMany(
    { pg: pgId, status: { $in: ['pending', 'correction_required'] } },
    { $set: { status: 'cancelled' } }
  );

  // Create a new update request
  const newRequest = new PGUpdateRequest({
    pg: pgId,
    owner: ownerId,
    proposedChanges: data,
    originalSnapshot,
    status: 'pending',
    auditLog: [
      {
        action: 'submitted',
        by: ownerId,
        at: new Date(),
        comment: 'Update submitted by owner',
      },
    ],
  });

  await newRequest.save();

  return { requestCreated: true, requestId: newRequest._id };
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

// ─── In-Memory Suggestions Cache (TTL: 5 minutes) ─────────────────────────
const _suggestionsCache = new Map();
const SUGGESTIONS_CACHE_TTL = 5 * 60 * 1000; // 5 min

const _getCachedSuggestions = (key) => {
  const entry = _suggestionsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _suggestionsCache.delete(key);
    return null;
  }
  return entry.data;
};

const _setCachedSuggestions = (key, data) => {
  // Evict old entries if cache grows too large (simple LRU-lite)
  if (_suggestionsCache.size > 200) {
    const firstKey = _suggestionsCache.keys().next().value;
    _suggestionsCache.delete(firstKey);
  }
  _suggestionsCache.set(key, { data, expiresAt: Date.now() + SUGGESTIONS_CACHE_TTL });
};

/**
 * Normalize a suggestion text for deduplication.
 * Strips city/state suffixes like ", Maharashtra, India" and lowercases.
 */
const _normalizeText = (text) =>
  text
    .toLowerCase()
    .replace(/,\s*(maharashtra|karnataka|delhi|tamil\s*nadu|telangana|west\s*bengal|rajasthan|gujarat|india)[^,]*/gi, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
/**
 * Get real-time autocomplete suggestions for search.
 * Improved: in-memory cache (5 min TTL), session tokens, smarter dedup, local-first ordering.
 *
 * @param {string} query        - The search text typed by user
 * @param {string} sessiontoken - UUID generated per search session (reduces Google billing)
 */
const getSuggestions = async (query, sessiontoken) => {
  if (!query || query.length < 2) return { suggestions: [] };

  const normalizedQuery = query.trim().toLowerCase();

  // ── 1. Check cache ─────────────────────────────────────────────────────────
  const cached = _getCachedSuggestions(normalizedQuery);
  if (cached) return { suggestions: cached };

  const regex = safeRegex(query.trim(), 'i');
  const suggestionsMap = new Map();

  // ── 2. Local DB suggestions (fast, always shown first) ────────────────────
  try {
    const pgs = await PG.find({
      $or: [
        { name: regex },
        { area: regex },
        { fullAddress: regex },
        { landmark: regex },
        { 'nearbyPlaces.name': regex },
      ],
      status: 'approved',
    })
      .select('name area city fullAddress landmark nearbyPlaces')
      .limit(15)
      .lean();

    pgs.forEach((pg) => {
      if (regex.test(pg.area)) {
        const norm = _normalizeText(pg.area);
        const key = `area:${norm}`;
        if (!suggestionsMap.has(key)) {
          suggestionsMap.set(key, { text: pg.area, type: 'area', city: pg.city, source: 'local' });
        }
      }
      if (regex.test(pg.name)) {
        const norm = _normalizeText(pg.name);
        const key = `pg_name:${norm}`;
        if (!suggestionsMap.has(key)) {
          suggestionsMap.set(key, { text: pg.name, type: 'pg_name', pgId: pg._id, source: 'local' });
        }
      }
      if (pg.landmark && regex.test(pg.landmark)) {
        const norm = _normalizeText(pg.landmark);
        const key = `landmark:${norm}`;
        if (!suggestionsMap.has(key)) {
          suggestionsMap.set(key, { text: pg.landmark, type: 'landmark', city: pg.city, source: 'local' });
        }
      }
    });
  } catch (dbErr) {
    console.warn('[Suggestions] Local DB search warning:', dbErr.message);
  }

  // ── 3. Google Places (appended after local, deduplicated) ─────────────────
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleApiKey) {
    try {
      const axios = require('axios');
      const googleParams = {
        input: query,
        key: googleApiKey,
        components: 'country:in',
        types: '(regions)',
      };
      // Session token groups autocomplete keystrokes → reduces Google billing ~10x
      if (sessiontoken) googleParams.sessiontoken = sessiontoken;

      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/autocomplete/json',
        { params: googleParams, timeout: 2500 }
      );

      if (response.data && response.data.predictions) {
        response.data.predictions.forEach((pred) => {
          const mainText = pred.structured_formatting?.main_text || pred.description;
          const norm = _normalizeText(mainText);
          // Only add if not already covered by a local result (avoids "Baner" + "Baner, Pune" duplicates)
          if (!suggestionsMap.has(`area:${norm}`) && !suggestionsMap.has(`landmark:${norm}`)) {
            suggestionsMap.set(`google:${pred.place_id}`, {
              text: mainText,
              subtext: pred.structured_formatting?.secondary_text || '',
              type: 'google_place',
              placeId: pred.place_id,
              source: 'google',
            });
          }
        });
      }
    } catch (e) {
      // Graceful degradation — Google timeout/error → return local results only
      console.warn('[Suggestions] Google Places unavailable:', e.message);
    }
  }

  const results = Array.from(suggestionsMap.values()).slice(0, 10);

  // ── 4. Cache merged result ────────────────────────────────────────────────
  _setCachedSuggestions(normalizedQuery, results);

  return { suggestions: results };
};

module.exports = { getPGs, getPGById, createPG, updatePG, deletePG, aiSearchPGs, buildSearchQuery, getSuggestions };

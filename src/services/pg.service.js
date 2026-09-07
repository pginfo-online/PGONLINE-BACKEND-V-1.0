const PG = require('../models/PG.model');
const PGUpdateRequest = require('../models/PGUpdateRequest.model');

/**
 * Escape special regular expression characters to prevent injection
 */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const safeRegex = (str, flags = 'i') => new RegExp(escapeRegex(str), flags);

/**
 * Build MongoDB query from search params.
 * Uses roomConfigs.$elemMatch as single source of truth for rent/sharing type queries.
 */
const buildSearchQuery = (params) => {
  const query = { status: 'approved' };

  // ── Location ────────────────────────────────────────────────────────────────
  if (params.city) query.city = params.city;

  if (params.areas) {
    const areaList = String(params.areas)
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 5); // allow up to 5 areas
    if (areaList.length > 0) {
      query.area = { $in: areaList.map((a) => safeRegex(a, 'i')) };
    }
  } else if (params.area && params.area.trim()) {
    query.area = { $regex: escapeRegex(params.area.trim()), $options: 'i' };
  }

  // ── Filters ─────────────────────────────────────────────────────────────────
  if (params.food) query.food = params.food;
  if (params.ac !== undefined) query.ac = params.ac === 'true';
  if (params.gender) query.gender = { $in: [params.gender, 'any'] };
  if (params.isVerified !== undefined) query.isVerified = params.isVerified === 'true';
  if (params.propertyType) query.propertyType = params.propertyType;

  // foodIncluded — separate boolean flag (food cost bundled into rent)
  if (params.foodIncluded !== undefined) query.foodIncluded = params.foodIncluded === 'true';

  // isAvailable — availability filter
  if (params.isAvailable !== undefined) query.isAvailable = params.isAvailable === 'true';

  // Preferred tenants filter
  if (params.preferredTenants) {
    const tenantType = params.preferredTenants.trim();
    query.preferredTenants = { $in: [tenantType, 'any'] };
  }

  // ── Rent / Sharing Type — uses roomConfigs as single source of truth ─────────
  if (params.minRent !== undefined || params.maxRent !== undefined || params.sharingType) {
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

    const elemMatch = {};
    if (params.sharingType) elemMatch.shareType = params.sharingType;
    const rentCondition = {};
    if (min !== undefined) rentCondition.$gte = min;
    if (max !== undefined) rentCondition.$lte = max;
    if (Object.keys(rentCondition).length > 0) elemMatch.rent = rentCondition;

    if (Object.keys(elemMatch).length > 0) {
      query.roomConfigs = { $elemMatch: elemMatch };
    }
  }

  // ── Text search ──────────────────────────────────────────────────────────────
  if (params.q && params.q.trim()) {
    const qRegex = safeRegex(params.q.trim(), 'i');
    const textConditions = [
      { name: qRegex },
      { area: qRegex },
      { fullAddress: qRegex },
      { landmark: qRegex },
      { city: qRegex },
      { description: qRegex },
      { 'nearbyPlaces.name': qRegex },
    ];

    if (query.roomConfigs) {
      // Already have a roomConfigs filter — combine with $and
      query.$and = [
        { roomConfigs: query.roomConfigs },
        { $or: textConditions },
      ];
      delete query.roomConfigs;
    } else {
      query.$or = textConditions;
    }
  }

  return query;
};

/**
 * Build sort object.
 * Note: rent sorting uses minRent virtual — for aggregation pipeline use roomConfigs.rent.
 */
const buildSort = (sort) => {
  switch (sort) {
    case 'rent_asc':  return { 'roomConfigs.rent': 1, createdAt: -1 };
    case 'rent_desc': return { 'roomConfigs.rent': -1, createdAt: -1 };
    case 'popular':   return { views: -1, inquiries: -1 };
    case 'distance':  return null; // handled implicitly by $geoNear
    default:          return { createdAt: -1 };
  }
};

/**
 * Auto-compute data quality score (1–5) based on completeness.
 * Score is optional and can be overridden by admin/owner.
 *
 * @param {object} pgData - plain object or Mongoose doc
 * @returns {number} score between 1 and 5
 */
const computeDataQualityScore = (pgData) => {
  let score = 1; // baseline

  // +1: has at least 3 photos
  if ((pgData.photos || []).length >= 3) score += 1;

  // +1: has a meaningful description (≥80 chars)
  if (pgData.description && pgData.description.trim().length >= 80) score += 1;

  // +1: has at least 2 nearby places with distances
  const validNearby = (pgData.nearbyPlaces || []).filter(
    (n) => n.name && n.distance != null
  );
  if (validNearby.length >= 2) score += 1;

  // +1: has roomConfigs with beds filled
  const configsWithBeds = (pgData.roomConfigs || []).filter(
    (rc) => rc.totalBeds > 0
  );
  if (configsWithBeds.length > 0) score += 1;

  return Math.min(5, score);
};

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
    const radius = parseFloat(params.radius) || 10;

    const geoNearStage = {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance',
        maxDistance: radius * 1000,
        query,
        spherical: true,
      },
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
          as: 'owner',
        },
      },
      { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: 1, city: 1, area: 1, address: 1,
          roomConfigs: 1, food: 1, ac: 1, gender: 1, preferredTenants: 1,
          photos: 1, isVerified: 1, isAvailable: 1, status: 1,
          createdAt: 1, distance: 1, latitude: 1, longitude: 1, location: 1,
          dataQualityScore: 1, monthlyPricing: 1, rent: 1,
          nearbyPlaces: 1, amenities: 1, propertyType: 1, rules: 1,
          description: 1, securityDeposit: 1, noticePeriod: 1, foodInfo: 1,
          'owner._id': 1, 'owner.name': 1, 'owner.email': 1, 'owner.phone': 1,
        },
      },
    ];

    const countPipeline = [geoNearStage, { $count: 'total' }];

    const [aggResult, countResult] = await Promise.all([
      PG.aggregate(pipeline),
      PG.aggregate(countPipeline),
    ]);

    pgs = aggResult;
    total = countResult.length > 0 ? countResult[0].total : 0;
  } else {
    const [findPgs, findTotal] = await Promise.all([
      PG.find(query)
        .select(
          'name city area address roomConfigs food ac gender preferredTenants photos monthlyPricing rent ' +
          'isVerified isAvailable status owner createdAt latitude longitude location dataQualityScore ' +
          'nearbyPlaces amenities propertyType rules description securityDeposit noticePeriod foodInfo'
        )
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

  // ── Public Sanitization & Pricing Guarantees ───────────────────────────────
  const isGuest = !user;
  const sanitizedPgs = pgs.map((item) => {
    const pgObj = { ...item, isPublicPreview: isGuest };
    if (isGuest && pgObj.owner) {
      delete pgObj.owner.email;
      delete pgObj.owner.phone;
    }
    return enrichPGPricing(pgObj, item.rent || item._doc?.rent);
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
 * Robust helper to guarantee consistent pricing fields across list & detail
 */
function enrichPGPricing(pgObj, rawStoredRent = null) {
  if (!pgObj) return pgObj;

  // 1. Recover stored rent object if pgObj.rent is missing or empty
  if (!pgObj.rent || typeof pgObj.rent !== 'object' || Object.keys(pgObj.rent).length === 0) {
    if (rawStoredRent && typeof rawStoredRent === 'object' && Object.keys(rawStoredRent).length > 0) {
      pgObj.rent = { ...rawStoredRent };
    } else {
      pgObj.rent = pgObj.rent || {};
    }
  }

  // 2. Extract rents from roomConfigs if available
  const rents = [];
  if (Array.isArray(pgObj.roomConfigs) && pgObj.roomConfigs.length > 0) {
    pgObj.roomConfigs.forEach((rc) => {
      const r = Number(rc.rent);
      if (!isNaN(r) && r > 0) {
        rents.push(r);
        if (rc.shareType && !pgObj.rent[rc.shareType]) {
          pgObj.rent[rc.shareType] = r;
        }
      }
    });
  }

  // 3. Compute minRent / maxRent
  if (rents.length > 0) {
    pgObj.minRent = Math.min(...rents);
    pgObj.maxRent = Math.max(...rents);
  } else if (pgObj.rent && typeof pgObj.rent === 'object') {
    const valid = Object.values(pgObj.rent).map(Number).filter((r) => !isNaN(r) && r > 0);
    if (valid.length > 0) {
      pgObj.minRent = Math.min(...valid);
      pgObj.maxRent = Math.max(...valid);
    }
  }

  const monthly = Number(pgObj.monthlyPricing);
  if (!pgObj.minRent && !isNaN(monthly) && monthly > 0) {
    pgObj.minRent = monthly;
    pgObj.maxRent = monthly;
    if (!pgObj.rent.single) pgObj.rent.single = monthly;
  }

  // 4. Synthesize roomConfigs if missing or has no valid rents, so UI always renders room configurations
  const hasValidRoomConfigRents =
    Array.isArray(pgObj.roomConfigs) &&
    pgObj.roomConfigs.length > 0 &&
    pgObj.roomConfigs.some((rc) => Number(rc.rent) > 0);

  if (!hasValidRoomConfigRents) {
    const synthetic = [];
    if (pgObj.rent && typeof pgObj.rent === 'object') {
      Object.entries(pgObj.rent).forEach(([shareType, rentVal]) => {
        const r = Number(rentVal);
        if (!isNaN(r) && r > 0) {
          synthetic.push({
            shareType,
            rent: r,
            availableBeds: pgObj.isAvailable ? 1 : 0,
            totalBeds: 1,
            depositAmount: pgObj.securityDeposit || 0,
          });
        }
      });
    }
    if (synthetic.length === 0 && pgObj.minRent) {
      synthetic.push({
        shareType: 'standard',
        rent: pgObj.minRent,
        availableBeds: pgObj.isAvailable ? 1 : 0,
        totalBeds: 1,
        depositAmount: pgObj.securityDeposit || 0,
      });
    }
    pgObj.roomConfigs = synthetic;
  }

  return pgObj;
}

/**
 * Get single PG by ID (increments view count)
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

  const rawStoredRent = pg._doc?.rent;
  const pgObj = pg.toObject();
  const isGuest = !user;
  pgObj.isPublicPreview = isGuest;

  if (isGuest) {
    if (pgObj.contactPhone) {
      const raw = pgObj.contactPhone.replace(/\D/g, '');
      pgObj.contactPhone =
        raw.length >= 10
          ? `+91 ${raw.slice(0, 2)}******${raw.slice(-2)}`
          : '+91 ********';
    } else {
      pgObj.contactPhone = '+91 ********';
    }
    delete pgObj.contactWhatsapp;
    delete pgObj.mapsLink;
    if (pgObj.owner) {
      delete pgObj.owner.email;
      delete pgObj.owner.phone;
    }
    if (pgObj.area && pgObj.city) {
      pgObj.address = `${pgObj.area}, ${pgObj.city} (Exact address unlocked after login)`;
    }
  }

  // Ensure rent and minRent and roomConfigs are reliably populated
  enrichPGPricing(pgObj, rawStoredRent);

  return pgObj;
};

/**
 * Create a new PG listing.
 *
 * Strategy:
 *  1. If googlePlaceId provided → check duplicate by placeId first (fast + reliable)
 *  2. Fallback duplicate check by owner + name + address regex
 *  3. If lat/lng already provided by client (from Google Maps widget) → skip geocoding
 *  4. Otherwise geocode the address string
 *  5. Auto-fetch nearby places server-side if lat/lng known
 *  6. Auto-compute dataQualityScore (unless owner provided one)
 *  7. Ensure area exists in Areas collection
 */
const createPG = async (ownerId, data) => {
  const name = data.name ? data.name.trim() : '';
  const city = data.city ? data.city.trim() : '';
  const area = data.area ? data.area.trim() : '';
  const address = data.address ? data.address.trim() : '';

  // ── 1. Duplicate check: prevent accidental double-submission by same owner ──
  const duplicateQuery = {
    owner: ownerId,
    name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') },
    status: { $in: ['pending', 'approved'] },
  };

  if (data.googlePlaceId) {
    duplicateQuery.$or = [
      { googlePlaceId: data.googlePlaceId },
      { city, area: { $regex: new RegExp(`^${escapeRegex(area)}$`, 'i') } },
    ];
  } else {
    duplicateQuery.city = city;
    duplicateQuery.area = { $regex: new RegExp(`^${escapeRegex(area)}$`, 'i') };
  }

  const existingPG = await PG.findOne(duplicateQuery).lean();
  if (existingPG) {
    const err = new Error(
      `You already have an active or pending PG listing named "${name}" in this area.`
    );
    err.statusCode = 409;
    throw err;
  }

  // ── 2. Location data ─────────────────────────────────────────────────────────
  let locationData = {};

  const hasCoords =
    data.latitude != null &&
    data.longitude != null &&
    !isNaN(Number(data.latitude)) &&
    !isNaN(Number(data.longitude));

  if (hasCoords) {
    // Trust client-provided coordinates (from Google Maps widget — most accurate)
    locationData = {
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      location: {
        type: 'Point',
        coordinates: [Number(data.longitude), Number(data.latitude)],
      },
    };
    // Preserve any other location fields already on data
    if (data.googlePlaceId) locationData.googlePlaceId = data.googlePlaceId;
    if (data.fullAddress)   locationData.fullAddress   = data.fullAddress;
    if (data.postalCode)    locationData.postalCode    = data.postalCode;
    if (data.state)         locationData.state         = data.state;
    if (data.district)      locationData.district      = data.district;
    if (data.country)       locationData.country       = data.country;
  } else {
    // Geocode from address string as fallback
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
            coordinates: [coords.longitude, coords.latitude],
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
  }

  // ── 3. Nearby Places (client provided or async background fill) ─────────────
  const nearbyPlaces = Array.isArray(data.nearbyPlaces) ? data.nearbyPlaces : [];
  const finalLat = locationData.latitude || data.latitude;
  const finalLng = locationData.longitude || data.longitude;

  // ── 5. Create PG ─────────────────────────────────────────────────────────────
  const pgPayload = {
    ...data,
    name,
    area,
    address,
    city,
    ...locationData,
    owner: ownerId,
    status: 'pending',
    nearbyPlaces,
  };

  // Remove virtual/read-only fields from payload if accidentally sent
  delete pgPayload.rent;
  delete pgPayload.totalBeds;
  delete pgPayload.availableBeds;
  delete pgPayload.minRent;
  delete pgPayload.maxRent;

  const pg = await PG.create(pgPayload);

  // Background nearby places auto-fill if empty (non-blocking)
  if (nearbyPlaces.length === 0 && finalLat && finalLng) {
    setImmediate(async () => {
      try {
        const { fetchNearbyPlacesForPG } = require('../utils/nearbyPlaces');
        const autoNearby = await fetchNearbyPlacesForPG(finalLat, finalLng);
        if (autoNearby && autoNearby.length > 0) {
          await PG.findByIdAndUpdate(pg._id, { $set: { nearbyPlaces: autoNearby } });
        }
      } catch (err) {
        console.warn('Async background nearby places warning:', err.message);
      }
    });
  }

  // ── 6. Auto-compute dataQualityScore (skip if owner set one explicitly) ──────
  if (data.dataQualityScore == null) {
    const score = computeDataQualityScore(pg.toObject());
    await PG.findByIdAndUpdate(pg._id, { dataQualityScore: score });
    pg.dataQualityScore = score;
  }

  // ── 7. Ensure area exists in Areas collection ─────────────────────────────────
  if (data.cityId && area) {
    try {
      const Area = require('../models/Area.model');
      const City = require('../models/City.model');
      const cityDoc = await City.findById(data.cityId).select('name').lean();
      if (cityDoc) {
        const slug = area.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        await Area.findOneAndUpdate(
          {
            city: data.cityId,
            name: { $regex: new RegExp(`^${escapeRegex(area)}$`, 'i') },
          },
          {
            $setOnInsert: {
              city: data.cityId,
              cityName: cityDoc.name,
              name: area,
              slug,
              isActive: true,
              isAutoCreated: true,
              source: 'user',
              order: 99,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    } catch (areaErr) {
      // Non-fatal — area creation failure should not block PG creation
      console.error('Area ensure error in createPG:', areaErr);
    }
  }

  // Update user role to owner
  const User = require('../models/User.model');
  await User.findByIdAndUpdate(ownerId, { role: 'owner' });

  return pg;
};

/**
 * Update a PG listing (direct update if admin; creates PGUpdateRequest if owner)
 */
const updatePG = async (pgId, userId, data, userRole = 'owner') => {
  const query = userRole === 'admin' ? { _id: pgId } : { _id: pgId, owner: userId };
  const pg = await PG.findOne(query);
  if (!pg) {
    const err = new Error('PG not found or you are not authorized');
    err.statusCode = 404;
    throw err;
  }

  // Direct update by admin — apply immediately to live PG
  if (userRole === 'admin') {
    delete data.rent;
    delete data.totalBeds;
    delete data.availableBeds;
    delete data.minRent;
    delete data.maxRent;

    if (data.photos && data.photos.length > 0) {
      const hasMain = data.photos.some((p) => p.isMain);
      if (!hasMain) data.photos[0].isMain = true;
    }

    if (data.dataQualityScore == null) {
      data.dataQualityScore = computeDataQualityScore({ ...pg.toObject(), ...data });
    }

    const updated = await PG.findByIdAndUpdate(
      pgId,
      { $set: data },
      { new: true, runValidators: true }
    );
    return { requestCreated: true, updatedPG: updated };
  }

  const originalSnapshot = pg.toObject();

  // Only geocode if address-related fields actually changed
  const addressChanged =
    (data.address && data.address !== pg.address) ||
    (data.area && data.area !== pg.area) ||
    (data.city && data.city !== pg.city);

  if (addressChanged) {
    // If client already provides new coordinates, trust them
    const clientHasCoords =
      data.latitude != null &&
      data.longitude != null &&
      !isNaN(Number(data.latitude)) &&
      !isNaN(Number(data.longitude));

    if (clientHasCoords) {
      data.location = {
        type: 'Point',
        coordinates: [Number(data.longitude), Number(data.latitude)],
      };
    } else {
      try {
        const { geocodeAddress } = require('../utils/geocoder');
        const fullAddress = `${data.address || pg.address}, ${data.area || pg.area}, ${data.city || pg.city}`;
        const coords = await geocodeAddress(fullAddress);
        if (coords) {
          data.latitude  = coords.latitude;
          data.longitude = coords.longitude;
          data.location  = { type: 'Point', coordinates: [coords.longitude, coords.latitude] };
          if (coords.fullAddress) data.fullAddress  = coords.fullAddress;
          if (coords.postalCode)  data.postalCode   = coords.postalCode;
          if (coords.country)     data.country      = coords.country;
          if (coords.state)       data.state        = coords.state;
          if (coords.district)    data.district     = coords.district;
          if (coords.placeId)     data.googlePlaceId = coords.placeId;
        }
      } catch (err) {
        console.error('Geocoding error in updatePG:', err);
      }
    }

    // If address changed and no nearby places sent, auto-fetch
    const finalLat = data.latitude || pg.latitude;
    const finalLng = data.longitude || pg.longitude;
    if (finalLat && finalLng && (!data.nearbyPlaces || data.nearbyPlaces.length === 0)) {
      try {
        const { fetchNearbyPlacesForPG } = require('../utils/nearbyPlaces');
        const autoNearby = await fetchNearbyPlacesForPG(finalLat, finalLng);
        if (autoNearby && autoNearby.length > 0) data.nearbyPlaces = autoNearby;
      } catch (err) {
        console.error('Auto nearby places error in updatePG:', err);
      }
    }
  }

  // Remove virtual/read-only fields from proposed changes
  delete data.rent;
  delete data.totalBeds;
  delete data.availableBeds;
  delete data.minRent;
  delete data.maxRent;

  // Cancel any existing pending/correction_required requests for this PG
  await PGUpdateRequest.updateMany(
    { pg: pgId, status: { $in: ['pending', 'correction_required'] } },
    { $set: { status: 'cancelled' } }
  );

  const requestOwnerId = pg.owner ? pg.owner : userId;

  const newRequest = new PGUpdateRequest({
    pg: pgId,
    owner: requestOwnerId,
    proposedChanges: data,
    originalSnapshot,
    status: 'pending',
    auditLog: [
      {
        action: 'submitted',
        by: userId,
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

// ─── In-Memory Suggestions Cache (TTL: 5 minutes) ────────────────────────────
const _suggestionsCache = new Map();
const SUGGESTIONS_CACHE_TTL = 5 * 60 * 1000;

const _getCachedSuggestions = (key) => {
  const entry = _suggestionsCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _suggestionsCache.delete(key); return null; }
  return entry.data;
};

const _setCachedSuggestions = (key, data) => {
  if (_suggestionsCache.size > 200) {
    const firstKey = _suggestionsCache.keys().next().value;
    _suggestionsCache.delete(firstKey);
  }
  _suggestionsCache.set(key, { data, expiresAt: Date.now() + SUGGESTIONS_CACHE_TTL });
};

const _normalizeText = (text) =>
  text
    .toLowerCase()
    .replace(/,\s*(maharashtra|karnataka|delhi|tamil\s*nadu|telangana|west\s*bengal|rajasthan|gujarat|india)[^,]*/gi, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();

/**
 * Get real-time autocomplete suggestions
 */
const getSuggestions = async (query, sessiontoken) => {
  if (!query || query.length < 2) return { suggestions: [] };

  const normalizedQuery = query.trim().toLowerCase();
  const cached = _getCachedSuggestions(normalizedQuery);
  if (cached) return { suggestions: cached };

  const regex = safeRegex(query.trim(), 'i');
  const suggestionsMap = new Map();

  // Local DB first
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
        const key = `area:${_normalizeText(pg.area)}`;
        if (!suggestionsMap.has(key)) {
          suggestionsMap.set(key, { text: pg.area, type: 'area', city: pg.city, source: 'local' });
        }
      }
      if (regex.test(pg.name)) {
        const key = `pg_name:${_normalizeText(pg.name)}`;
        if (!suggestionsMap.has(key)) {
          suggestionsMap.set(key, { text: pg.name, type: 'pg_name', pgId: pg._id, source: 'local' });
        }
      }
      if (pg.landmark && regex.test(pg.landmark)) {
        const key = `landmark:${_normalizeText(pg.landmark)}`;
        if (!suggestionsMap.has(key)) {
          suggestionsMap.set(key, { text: pg.landmark, type: 'landmark', city: pg.city, source: 'local' });
        }
      }
      if (Array.isArray(pg.nearbyPlaces)) {
        pg.nearbyPlaces.forEach((np) => {
          if (np?.name && regex.test(np.name)) {
            const key = `nearby:${_normalizeText(np.name)}`;
            if (!suggestionsMap.has(key)) {
              suggestionsMap.set(key, {
                text: np.name,
                type: 'nearby_place',
                placeType: np.placeType || 'other',
                area: pg.area,
                city: pg.city,
                source: 'local',
              });
            }
          }
        });
      }
    });
  } catch (dbErr) {
    console.warn('[Suggestions] Local DB search warning:', dbErr.message);
  }

  // Google Places autocomplete
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
      if (sessiontoken) googleParams.sessiontoken = sessiontoken;

      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/autocomplete/json',
        { params: googleParams, timeout: 2500 }
      );

      if (response.data && response.data.predictions) {
        response.data.predictions.forEach((pred) => {
          const mainText = pred.structured_formatting?.main_text || pred.description;
          const norm = _normalizeText(mainText);
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
      console.warn('[Suggestions] Google Places unavailable:', e.message);
    }
  }

  const results = Array.from(suggestionsMap.values()).slice(0, 10);
  _setCachedSuggestions(normalizedQuery, results);
  return { suggestions: results };
};

module.exports = {
  getPGs,
  getPGById,
  createPG,
  updatePG,
  deletePG,
  aiSearchPGs,
  buildSearchQuery,
  getSuggestions,
  computeDataQualityScore,
};

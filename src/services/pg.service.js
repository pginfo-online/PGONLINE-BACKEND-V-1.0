const PG = require('../models/PG.model');
const PGUpdateRequest = require('../models/PGUpdateRequest.model');

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

/**
 * Get real-time autocomplete suggestions for search
 */
const getSuggestions = async (query) => {
  if (!query || query.length < 2) return { suggestions: [] };

  const regex = new RegExp(query, 'i');

  // Search by name, area, landmark, fullAddress
  const pgs = await PG.find({
    $or: [
      { name: regex },
      { area: regex },
      { fullAddress: regex },
      { landmark: regex },
      { 'nearbyPlaces.name': regex }
    ],
    status: 'approved'
  })
    .select('name area city fullAddress landmark nearbyPlaces')
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
    if (pg.landmark && regex.test(pg.landmark)) {
      const key = `landmark:${pg.landmark}`;
      if (!suggestionsMap.has(key)) {
        suggestionsMap.set(key, { text: pg.landmark, type: 'landmark', city: pg.city });
      }
    }
  });

  // Add Google Places Autocomplete if configured
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleApiKey) {
    try {
      const axios = require('axios');
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/autocomplete/json', {
        params: { input: query, key: googleApiKey, components: 'country:in' },
        timeout: 2500
      });
      if (response.data && response.data.predictions) {
        response.data.predictions.forEach(pred => {
          suggestionsMap.set(`google:${pred.place_id}`, {
            text: pred.description,
            type: 'google_place',
            placeId: pred.place_id
          });
        });
      }
    } catch (e) {
      console.error('Places Autocomplete Error:', e.message);
    }
  }

  return { suggestions: Array.from(suggestionsMap.values()).slice(0, 10) };
};

module.exports = { getPGs, getPGById, createPG, updatePG, deletePG, aiSearchPGs, buildSearchQuery, getSuggestions };

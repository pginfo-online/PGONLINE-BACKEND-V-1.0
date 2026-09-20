const Property = require('../models/Property.model');
const PropertyUpdateRequest = require('../models/PropertyUpdateRequest.model');
const User = require('../models/User.model');
const City = require('../models/City.model');

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Auto-compute data quality score (1–5) based on completeness
 */
const computeDataQualityScore = (data) => {
  let score = 1;

  // +1: at least 3 photos
  if ((data.photos || []).length >= 3) score += 1;

  // +1: meaningful description (>= 80 chars)
  if (data.description && data.description.trim().length >= 80) score += 1;

  // +1: at least 2 nearby places
  const validNearby = (data.nearbyPlaces || []).filter((n) => n.name && n.distance != null);
  if (validNearby.length >= 2) score += 1;

  // +1: Category-specific depth
  if (data.category === 'pg' && data.pgDetails?.roomConfigs?.length > 0) {
    score += 1;
  } else if (data.category === 'residential_rental' && data.residentialDetails?.bhk && data.residentialDetails?.carpetAreaSqFt > 0) {
    score += 1;
  } else if (data.category === 'commercial' && data.commercialDetails?.commercialSubtype && data.commercialDetails?.carpetAreaSqFt > 0) {
    score += 1;
  }

  return Math.min(5, score);
};

const removeInactiveCategoryDetails = (data, category) => {
  if (category === 'pg') {
    delete data.residentialDetails;
    delete data.commercialDetails;
  } else if (category === 'residential_rental') {
    delete data.pgDetails;
    delete data.commercialDetails;
  } else if (category === 'commercial') {
    delete data.pgDetails;
    delete data.residentialDetails;
  }
};

const canonicalizePropertyCity = async (data) => {
  let cityDoc = null;

  if (data.cityId) {
    cityDoc = await City.findOne({ _id: data.cityId, isActive: true })
      .select('_id name')
      .lean();
    if (!cityDoc) {
      const err = new Error('Selected city is invalid or inactive');
      err.statusCode = 400;
      throw err;
    }
  } else if (data.city) {
    const escapedCity = String(data.city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cityPattern = new RegExp(`^${escapedCity}$`, 'i');
    cityDoc = await City.findOne({ isActive: true, name: cityPattern })
      .select('_id name')
      .lean();
    if (!cityDoc) {
      cityDoc = await City.findOne({ isActive: true, aliases: cityPattern })
        .select('_id name')
        .lean();
    }
  }

  if (cityDoc) {
    data.cityId = cityDoc._id;
    data.city = cityDoc.name;
  }
};

/**
 * Create a new property listing (PG, Residential Rental, Commercial)
 */
const createProperty = async (ownerId, data) => {
  const title = (data.title || data.name || '').trim();
  const city = (data.city || '').trim();
  const area = (data.area || '').trim();
  const address = (data.address || '').trim();
  const category = data.category || 'pg';
  const purpose = data.purpose || 'rent';

  // 1. Duplicate check: prevent accidental double-submission by same owner
  const duplicateQuery = {
    owner: ownerId,
    category,
    title: { $regex: new RegExp(`^${escapeRegex(title)}$`, 'i') },
    status: { $in: ['submitted', 'pending_review', 'approved'] },
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

  const existing = await Property.findOne(duplicateQuery).lean();
  if (existing) {
    const err = new Error(`You already have an active or pending listing titled "${title}" in this area.`);
    err.statusCode = 409;
    throw err;
  }

  // 2. Location coordinates
  let locationData = {};
  const hasCoords =
    data.latitude != null &&
    data.longitude != null &&
    !isNaN(Number(data.latitude)) &&
    !isNaN(Number(data.longitude));

  if (hasCoords) {
    locationData = {
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      location: {
        type: 'Point',
        coordinates: [Number(data.longitude), Number(data.latitude)],
      },
    };
    if (data.googlePlaceId) locationData.googlePlaceId = data.googlePlaceId;
    if (data.fullAddress)   locationData.fullAddress   = data.fullAddress;
    if (data.postalCode)    locationData.postalCode    = data.postalCode;
    if (data.state)         locationData.state         = data.state;
    if (data.district)      locationData.district      = data.district;
    if (data.country)       locationData.country       = data.country;
  } else {
    // Fallback: geocode address
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
    } catch (geoErr) {
      console.error('Geocoding error in createProperty:', geoErr);
    }
  }

  const finalLat = locationData.latitude || data.latitude;
  const finalLng = locationData.longitude || data.longitude;
  const nearbyPlaces = Array.isArray(data.nearbyPlaces) ? data.nearbyPlaces : [];

  // 3. Assemble payload
  const propertyPayload = {
    ...data,
    title,
    city,
    area,
    address,
    category,
    purpose,
    owner: ownerId,
    status: data.status === 'draft' ? 'draft' : 'submitted',
    nearbyPlaces,
    ...locationData,
  };

  await canonicalizePropertyCity(propertyPayload);
  removeInactiveCategoryDetails(propertyPayload, category);

  // Remove legacy virtual fields if passed
  delete propertyPayload.rent;
  delete propertyPayload.minRent;
  delete propertyPayload.maxRent;
  delete propertyPayload.totalBeds;
  delete propertyPayload.availableBeds;

  const property = await Property.create(propertyPayload);

  // 4. Auto-compute quality score
  const score = computeDataQualityScore(property.toObject());
  property.dataQualityScore = score;
  await Property.findByIdAndUpdate(property._id, { dataQualityScore: score });

  // 5. Auto-fetch nearby places in background if empty
  if (nearbyPlaces.length === 0 && finalLat && finalLng) {
    setImmediate(async () => {
      try {
        const { fetchNearbyPlacesForPG } = require('../utils/nearbyPlaces');
        const autoPlaces = await fetchNearbyPlacesForPG(finalLat, finalLng);
        if (autoPlaces && autoPlaces.length > 0) {
          await Property.findByIdAndUpdate(property._id, { $set: { nearbyPlaces: autoPlaces } });
        }
      } catch (e) {
        console.warn('Async nearby places error in createProperty:', e.message);
      }
    });
  }

  // 6. Ensure area is registered in Area collection
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
      console.error('Area ensure error in createProperty:', areaErr.message);
    }
  }

  // 7. Auto-upgrade user role: add 'owner' if tenant
  await User.findByIdAndUpdate(ownerId, {
    $addToSet: { roles: 'owner' },
    $set: { role: 'owner' },
  });

  return property;
};

/**
 * Update property (direct update if Admin or Draft; staging PropertyUpdateRequest if approved)
 */
const updateProperty = async (propertyId, userId, data, userRole = 'owner') => {
  const query = userRole === 'admin' ? { _id: propertyId } : { _id: propertyId, owner: userId };
  const property = await Property.findOne(query);

  if (!property) {
    const err = new Error('Property not found or unauthorized');
    err.statusCode = 404;
    throw err;
  }

  removeInactiveCategoryDetails(data, data.category || property.category);
  await canonicalizePropertyCity(data);

  // Direct update for admin or unapproved drafts
  if (userRole === 'admin' || property.status === 'draft' || property.status === 'correction_required') {
    if (data.photos && data.photos.length > 0) {
      const hasMain = data.photos.some((p) => p.isMain);
      if (!hasMain) data.photos[0].isMain = true;
    }

    data.dataQualityScore = computeDataQualityScore({ ...property.toObject(), ...data });

    // If it was correction_required, reset status to submitted
    if (property.status === 'correction_required' && userRole !== 'admin') {
      data.status = 'submitted';
    }

    const updated = await Property.findByIdAndUpdate(
      propertyId,
      { $set: data },
      { new: true, runValidators: true }
    );
    return { requestCreated: false, property: updated };
  }

  // Approved listing edited by owner -> Stage changes via PropertyUpdateRequest
  const originalSnapshot = property.toObject();

  // Cancel any existing pending requests for this property
  await PropertyUpdateRequest.updateMany(
    { property: propertyId, status: { $in: ['pending', 'correction_required'] } },
    { $set: { status: 'cancelled' } }
  );

  const newRequest = new PropertyUpdateRequest({
    property: propertyId,
    category: property.category,
    owner: userId,
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
 * Delete property
 */
const deleteProperty = async (propertyId, userId, role) => {
  const query = role === 'admin' ? { _id: propertyId } : { _id: propertyId, owner: userId };
  const property = await Property.findOneAndDelete(query);
  if (!property) {
    const err = new Error('Property not found or unauthorized');
    err.statusCode = 404;
    throw err;
  }
  return property;
};

/**
 * Get property by ID with guest privacy masking
 */
const getPropertyById = async (propertyId, user = null) => {
  const property = await Property.findByIdAndUpdate(
    propertyId,
    { $inc: { views: 1 } },
    { new: true }
  ).populate('owner', 'name email phone profilePhoto');

  if (!property) {
    const err = new Error('Property not found');
    err.statusCode = 404;
    throw err;
  }

  const propObj = property.toObject();
  const isGuest = !user;
  propObj.isPublicPreview = isGuest;

  if (isGuest) {
    if (propObj.contactPhone) {
      const raw = propObj.contactPhone.replace(/\D/g, '');
      propObj.contactPhone =
        raw.length >= 10
          ? `+91 ${raw.slice(0, 2)}******${raw.slice(-2)}`
          : '+91 ********';
    }
    delete propObj.contactWhatsapp;
    delete propObj.mapsLink;
    if (propObj.owner) {
      delete propObj.owner.email;
      delete propObj.owner.phone;
    }
    if (propObj.area && propObj.city) {
      propObj.address = `${propObj.area}, ${propObj.city} (Exact address unlocked after login)`;
    }
  }

  return propObj;
};

/**
 * Get Owner's properties with pagination and filtering
 */
const getMyPropertiesPaginated = async (ownerId, params = {}) => {
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(params.limit, 10) || 12));
  const skip = (page - 1) * limit;

  const query = { owner: ownerId };

  if (params.category && params.category !== 'all') {
    query.category = params.category;
  }

  if (params.status && params.status !== 'all') {
    query.status = params.status;
  }

  if (params.q && params.q.trim()) {
    const clean = params.q.trim();
    const regex = new RegExp(escapeRegex(clean), 'i');
    query.$or = [
      { title: regex },
      { name: regex },
      { area: regex },
      { city: regex },
      { address: regex },
      { contactPhone: regex },
    ];
  }

  const [properties, total] = await Promise.all([
    Property.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
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

module.exports = {
  createProperty,
  updateProperty,
  deleteProperty,
  getPropertyById,
  getMyPropertiesPaginated,
};

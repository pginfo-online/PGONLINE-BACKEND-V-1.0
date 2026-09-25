const Property = require('../models/Property.model');
const PropertyUpdateRequest = require('../models/PropertyUpdateRequest.model');
const PG = require('../models/PG.model');
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

const cleanNumber = (val) => {
  if (val === '' || val === null || val === undefined) return undefined;
  const num = Number(val);
  return isNaN(num) ? undefined : num;
};

const sanitizePropertyPayload = (data) => {
  if (!data || typeof data !== 'object') return;

  // Clean pricing numbers
  if (data.pricing) {
    if (data.pricing.expectedPrice !== undefined) data.pricing.expectedPrice = cleanNumber(data.pricing.expectedPrice) ?? 0;
    if (data.pricing.pricePerSqFt !== undefined) data.pricing.pricePerSqFt = cleanNumber(data.pricing.pricePerSqFt);
    if (data.pricing.securityDeposit !== undefined) data.pricing.securityDeposit = cleanNumber(data.pricing.securityDeposit) ?? 0;
    if (data.pricing.depositMonths !== undefined) data.pricing.depositMonths = cleanNumber(data.pricing.depositMonths);
    if (data.pricing.maintenanceCharges !== undefined) data.pricing.maintenanceCharges = cleanNumber(data.pricing.maintenanceCharges) ?? 0;
    if (data.pricing.bookingAmount !== undefined) data.pricing.bookingAmount = cleanNumber(data.pricing.bookingAmount);
    if (data.pricing.camChargesPerSqFt !== undefined) data.pricing.camChargesPerSqFt = cleanNumber(data.pricing.camChargesPerSqFt);
    if (data.pricing.dgBackupCharges !== undefined) data.pricing.dgBackupCharges = cleanNumber(data.pricing.dgBackupCharges);
  }

  // Clean residential numbers
  if (data.residentialDetails) {
    const rd = data.residentialDetails;
    rd.bedrooms = cleanNumber(rd.bedrooms) ?? 1;
    rd.bathrooms = cleanNumber(rd.bathrooms) ?? 1;
    rd.balconies = cleanNumber(rd.balconies) ?? 0;
    rd.carpetAreaSqFt = cleanNumber(rd.carpetAreaSqFt) ?? 0;
    rd.builtUpAreaSqFt = cleanNumber(rd.builtUpAreaSqFt);
    rd.superBuiltUpAreaSqFt = cleanNumber(rd.superBuiltUpAreaSqFt);
    rd.plotAreaSqYards = cleanNumber(rd.plotAreaSqYards);
    rd.floorNumber = cleanNumber(rd.floorNumber ?? rd.floorNo);
    rd.floorNo = cleanNumber(rd.floorNo ?? rd.floorNumber);
    rd.totalFloors = cleanNumber(rd.totalFloors);
    rd.propertyAgeYears = cleanNumber(rd.propertyAgeYears ?? rd.propertyAge);
    rd.propertyAge = cleanNumber(rd.propertyAge ?? rd.propertyAgeYears);
    rd.reservedCoveredParking = cleanNumber(rd.reservedCoveredParking) ?? 0;
    rd.openParking = cleanNumber(rd.openParking) ?? 0;
    rd.lockInPeriodMonths = cleanNumber(rd.lockInPeriodMonths) ?? 0;
    rd.noticePeriodDays = cleanNumber(rd.noticePeriodDays) ?? 30;

    if (rd.furnishingDetails) {
      const fd = rd.furnishingDetails;
      fd.fans = cleanNumber(fd.fans) ?? 0;
      fd.lights = cleanNumber(fd.lights) ?? 0;
      fd.wardrobes = cleanNumber(fd.wardrobes) ?? 0;
      fd.geysers = cleanNumber(fd.geysers) ?? 0;
      fd.acCount = cleanNumber(fd.acCount) ?? 0;
      fd.bedsCount = cleanNumber(fd.bedsCount) ?? 0;
    }
  }

  // Clean commercial numbers
  if (data.commercialDetails) {
    const cd = data.commercialDetails;
    cd.carpetAreaSqFt = cleanNumber(cd.carpetAreaSqFt) ?? 0;
    cd.superBuiltUpAreaSqFt = cleanNumber(cd.superBuiltUpAreaSqFt);
    cd.plotAreaSqFt = cleanNumber(cd.plotAreaSqFt);
    cd.ceilingHeightFt = cleanNumber(cd.ceilingHeightFt ?? cd.floorToCeilingHeightFt);
    cd.floorToCeilingHeightFt = cleanNumber(cd.floorToCeilingHeightFt ?? cd.ceilingHeightFt);
    cd.entranceWidthFt = cleanNumber(cd.entranceWidthFt);
    cd.floorNumber = cleanNumber(cd.floorNumber ?? cd.floorNo);
    cd.floorNo = cleanNumber(cd.floorNo ?? cd.floorNumber);
    cd.totalFloors = cleanNumber(cd.totalFloors);
    cd.passengerLifts = cleanNumber(cd.passengerLifts) ?? 0;
    cd.goodsLifts = cleanNumber(cd.goodsLifts ?? cd.serviceLifts) ?? 0;
    cd.serviceLifts = cleanNumber(cd.serviceLifts ?? cd.goodsLifts) ?? 0;
    cd.loadingDocks = cleanNumber(cd.loadingDocks) ?? 0;
    cd.powerLoadKW = cleanNumber(cd.powerLoadKW);
    cd.powerBackupCapacityKVA = cleanNumber(cd.powerBackupCapacityKVA);
    cd.floorLoadCapacityTonsPerSqM = cleanNumber(cd.floorLoadCapacityTonsPerSqM);
    cd.coveredParkingSlots = cleanNumber(cd.coveredParkingSlots ?? cd.reservedParkingSlots) ?? 0;
    cd.reservedParkingSlots = cleanNumber(cd.reservedParkingSlots ?? cd.coveredParkingSlots) ?? 0;
    cd.openParkingSlots = cleanNumber(cd.openParkingSlots ?? cd.visitorParkingSlots) ?? 0;
    cd.visitorParkingSlots = cleanNumber(cd.visitorParkingSlots ?? cd.openParkingSlots) ?? 0;
    cd.parkingRatioPer1000SqFt = cleanNumber(cd.parkingRatioPer1000SqFt);

    if (cd.fitoutDetails) {
      const fit = cd.fitoutDetails;
      fit.workstationsCount = cleanNumber(fit.workstationsCount) ?? 0;
      fit.cabinsCount = cleanNumber(fit.cabinsCount) ?? 0;
      fit.meetingRoomsCount = cleanNumber(fit.meetingRoomsCount) ?? 0;
      fit.conferenceRoomsCount = cleanNumber(fit.conferenceRoomsCount) ?? 0;
      fit.privateWashrooms = cleanNumber(fit.privateWashrooms) ?? 0;
      fit.publicWashroomsPerFloor = cleanNumber(fit.publicWashroomsPerFloor) ?? 0;
    }

    if (cd.leaseTerms) {
      const lt = cd.leaseTerms;
      lt.minLeasePeriodMonths = cleanNumber(lt.minLeasePeriodMonths);
      lt.leaseDurationYears = cleanNumber(lt.leaseDurationYears) ?? 3;
      lt.lockInPeriodMonths = cleanNumber(lt.lockInPeriodMonths) ?? 12;
      lt.fitOutPeriodDays = cleanNumber(lt.fitOutPeriodDays) ?? 0;
      lt.annualRentEscalationPercent = cleanNumber(lt.annualRentEscalationPercent) ?? 5;
      lt.noticePeriodDays = cleanNumber(lt.noticePeriodDays);
    }
  }

  // Clean PG numbers
  if (data.pgDetails) {
    const pg = data.pgDetails;
    pg.floors = cleanNumber(pg.floors);
    pg.totalRooms = cleanNumber(pg.totalRooms);
    pg.propertyAge = cleanNumber(pg.propertyAge);
    pg.noticePeriod = cleanNumber(pg.noticePeriod);
    pg.minStay = cleanNumber(pg.minStay);
    pg.maxStay = cleanNumber(pg.maxStay);
    pg.availableRooms = cleanNumber(pg.availableRooms) ?? 0;

    const hasFood = (pg.food && pg.food !== 'none') || pg.foodInfo?.provided === true;
    const foodType = (pg.food && pg.food !== 'none')
      ? pg.food
      : (pg.foodInfo?.type && pg.foodInfo.type !== 'none')
        ? pg.foodInfo.type
        : (hasFood ? 'both' : 'none');

    const foodInc = hasFood ? (pg.foodIncluded ?? pg.foodInfo?.includedInRent ?? false) : false;
    const foodCost = (hasFood && !foodInc)
      ? (cleanNumber(pg.foodInfo?.mealCostPerMonth ?? pg.foodInfo?.monthlyFoodCharge) ?? 0)
      : 0;

    pg.food = hasFood ? foodType : 'none';
    pg.foodIncluded = foodInc;
    if (pg.foodInfo || hasFood) {
      pg.foodInfo = pg.foodInfo || {};
      pg.foodInfo.provided = hasFood;
      pg.foodInfo.type = hasFood ? foodType : 'veg';
      pg.foodInfo.includedInRent = foodInc;
      pg.foodInfo.mealCostPerMonth = foodCost;
      pg.foodInfo.monthlyFoodCharge = foodCost;
      pg.foodInfo.mealsPerDay = cleanNumber(pg.foodInfo.mealsPerDay) || 2;
      const kAccess = pg.foodInfo.kitchenAccess ?? pg.foodInfo.kitchenAccessForTenants ?? false;
      pg.foodInfo.kitchenAccess = kAccess;
      pg.foodInfo.kitchenAccessForTenants = kAccess;
    }

    if (Array.isArray(pg.roomConfigs)) {
      pg.roomConfigs.forEach((rc) => {
        rc.sharing = cleanNumber(rc.sharing);
        rc.rent = cleanNumber(rc.rent ?? rc.monthlyRent) ?? 0;
        rc.monthlyRent = cleanNumber(rc.monthlyRent ?? rc.rent) ?? 0;
        rc.deposit = cleanNumber(rc.deposit ?? rc.depositAmount);
        rc.depositAmount = cleanNumber(rc.depositAmount ?? rc.deposit);
        rc.totalBeds = cleanNumber(rc.totalBeds) ?? 0;
        rc.availableBeds = cleanNumber(rc.availableBeds) ?? 0;
      });
    }
  }
};

const removeInactiveCategoryDetails = (data, category, purpose) => {
  if (category === 'pg') {
    delete data.residentialDetails;
    delete data.commercialDetails;
  } else if (category === 'residential_rental') {
    delete data.pgDetails;
    delete data.commercialDetails;
  } else if (category === 'commercial') {
    delete data.pgDetails;
    delete data.residentialDetails;
    if (data.commercialDetails) {
      if (purpose === 'sale') {
        delete data.commercialDetails.leaseTerms;
      } else if (purpose === 'rent') {
        delete data.commercialDetails.saleTerms;
      }
    }
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

  sanitizePropertyPayload(data);

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
  removeInactiveCategoryDetails(propertyPayload, category, purpose);

  // Ensure at least one photo is marked isMain
  if (Array.isArray(propertyPayload.photos) && propertyPayload.photos.length > 0) {
    if (!propertyPayload.photos.some((p) => p.isMain)) {
      propertyPayload.photos[0].isMain = true;
    }
  }

  // Derive min rent from roomConfigs if expectedPrice is zero or not set
  if (category === 'pg' && propertyPayload.pgDetails?.roomConfigs?.length > 0) {
    const rents = propertyPayload.pgDetails.roomConfigs
      .map((r) => Number(r.monthlyRent || r.rent))
      .filter((r) => !isNaN(r) && r > 0);
    if (rents.length > 0) {
      const minRent = Math.min(...rents);
      if (!propertyPayload.pricing) propertyPayload.pricing = {};
      if (!propertyPayload.pricing.expectedPrice || propertyPayload.pricing.expectedPrice === 0) {
        propertyPayload.pricing.expectedPrice = minRent;
      }
      if (!propertyPayload.pricing.securityDeposit || propertyPayload.pricing.securityDeposit === 0) {
        propertyPayload.pricing.securityDeposit = propertyPayload.pgDetails.roomConfigs[0].deposit || minRent;
      }
    }
  }

  const property = await Property.create(propertyPayload);

  // Keep PG collection synchronized with identical _id
  if (category === 'pg') {
    try {
      const PG = require('../models/PG.model');
      await PG.findByIdAndUpdate(
        property._id,
        {
          $set: {
            _id: property._id,
            owner: property.owner,
            name: property.title,
            description: property.description,
            city: property.city,
            area: property.area,
            address: property.address,
            fullAddress: property.fullAddress,
            latitude: property.latitude,
            longitude: property.longitude,
            location: property.location,
            photos: property.photos,
            videos: property.videos,
            facilities: property.amenities,
            contactPhone: property.contactPhone,
            contactWhatsapp: property.contactWhatsapp,
            nearbyPlaces: property.nearbyPlaces,
            status: property.status,
            isVerified: property.isVerified,
            roomConfigs: property.pgDetails?.roomConfigs || [],
            minRent: property.pricing?.expectedPrice || 0,
            securityDeposit: property.pricing?.securityDeposit || 0,
            food: property.pgDetails?.food || 'none',
            foodIncluded: property.pgDetails?.foodIncluded || false,
            foodInfo: property.pgDetails?.foodInfo || {},
            ac: property.pgDetails?.ac || false,
            gender: property.pgDetails?.gender || 'any',
            rules: property.pgDetails?.rules || {},
          },
        },
        { upsert: true }
      );
    } catch (pgSyncErr) {
      console.warn('PG sync warning on createProperty:', pgSyncErr.message);
    }
  }

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

  sanitizePropertyPayload(data);
  removeInactiveCategoryDetails(data, data.category || property.category, data.purpose || property.purpose);
  await canonicalizePropertyCity(data);

  // Direct update for admin, unapproved drafts, submitted, pending_review, correction_required, or rejected listings
  if (
    userRole === 'admin' ||
    property.status === 'draft' ||
    property.status === 'submitted' ||
    property.status === 'pending_review' ||
    property.status === 'correction_required' ||
    property.status === 'rejected'
  ) {
    if (data.photos && data.photos.length > 0) {
      const hasMain = data.photos.some((p) => p.isMain);
      if (!hasMain) data.photos[0].isMain = true;
    }

    data.dataQualityScore = computeDataQualityScore({ ...property.toObject(), ...data });

    // If it was correction_required or rejected, reset status to submitted
    if (
      (property.status === 'correction_required' || property.status === 'rejected') &&
      userRole !== 'admin'
    ) {
      data.status = 'submitted';
      data.rejectionReason = null;
      data.correctionComments = null;
    }

    const updated = await Property.findByIdAndUpdate(
      propertyId,
      { $set: data },
      { new: true, runValidators: true }
    );

    if (updated.category === 'pg') {
      try {
        const PG = require('../models/PG.model');
        const pgSync = {};
        if (data.title) pgSync.name = data.title;
        if (data.description !== undefined) pgSync.description = data.description;
        if (data.city) pgSync.city = data.city;
        if (data.area) pgSync.area = data.area;
        if (data.address) pgSync.address = data.address;
        if (data.photos) pgSync.photos = data.photos;
        if (data.videos) pgSync.videos = data.videos;
        if (data.amenities) pgSync.facilities = data.amenities;
        if (data.contactPhone) pgSync.contactPhone = data.contactPhone;
        if (data.contactWhatsapp !== undefined) pgSync.contactWhatsapp = data.contactWhatsapp;
        if (data.status) pgSync.status = data.status;
        if (data.pgDetails?.roomConfigs) {
          pgSync.roomConfigs = data.pgDetails.roomConfigs;
          const rents = data.pgDetails.roomConfigs.map((r) => Number(r.monthlyRent || r.rent)).filter((r) => !isNaN(r) && r > 0);
          if (rents.length > 0) pgSync.minRent = Math.min(...rents);
        }
        if (data.pricing?.expectedPrice) pgSync.minRent = data.pricing.expectedPrice;
        if (data.pricing?.securityDeposit) pgSync.securityDeposit = data.pricing.securityDeposit;
        if (data.pgDetails?.food) pgSync.food = data.pgDetails.food;
        if (data.pgDetails?.foodIncluded !== undefined) pgSync.foodIncluded = data.pgDetails.foodIncluded;
        if (data.pgDetails?.foodInfo) pgSync.foodInfo = data.pgDetails.foodInfo;
        if (Object.keys(pgSync).length > 0) {
          await PG.findByIdAndUpdate(propertyId, { $set: pgSync });
        }
      } catch (pgSyncErr) {
        console.warn('PG sync warning on direct updateProperty:', pgSyncErr.message);
      }
    }

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
  try {
    const PG = require('../models/PG.model');
    await PG.findByIdAndDelete(propertyId);
  } catch (e) {}
  return property;
};

/**
 * Get property by ID with guest privacy masking
 */
const getPropertyById = async (propertyId, user = null) => {
  let property = await Property.findByIdAndUpdate(
    propertyId,
    { $inc: { views: 1 } },
    { new: true }
  ).populate('owner', 'name email phone profilePhoto');

  if (!property) {
    const legacyPg = await PG.findByIdAndUpdate(
      propertyId,
      { $inc: { views: 1 } },
      { new: true }
    ).populate('owner', 'name email phone profilePhoto');

    if (legacyPg) {
      const pgObj = legacyPg.toObject();
      property = {
        toObject: () => ({
          ...pgObj,
          category: 'pg',
          purpose: 'rent',
          title: pgObj.name,
          photos: pgObj.photos || [],
          pricing: {
            expectedPrice: pgObj.minRent || pgObj.rent?.single || 0,
            securityDeposit: pgObj.securityDeposit || 0,
          },
          pgDetails: {
            gender: pgObj.gender,
            roomConfigs: pgObj.roomConfigs || [],
            food: pgObj.food,
            foodIncluded: pgObj.foodIncluded,
            foodInfo: pgObj.foodInfo,
            rules: pgObj.rules,
            totalRooms: pgObj.totalRooms,
            floors: pgObj.floors,
          },
        }),
      };
    }
  }

  if (!property) {
    const err = new Error('Property not found');
    err.statusCode = 404;
    throw err;
  }

  const propObj = property.toObject();
  const isGuest = !user;
  propObj.isPublicPreview = isGuest;

  // Ensure backward-compatibility for PG callers and user-facing screens
  if (propObj.category === 'pg' || propObj.pgDetails) {
    propObj.name = propObj.name || propObj.title;
    propObj.facilities = propObj.facilities || propObj.amenities || [];
    propObj.amenities = propObj.amenities || propObj.facilities || [];
    propObj.roomConfigs = propObj.roomConfigs || propObj.pgDetails?.roomConfigs || [];
    propObj.gender = propObj.gender || propObj.pgDetails?.gender || 'any';
    propObj.food = propObj.food || propObj.pgDetails?.food || 'none';
    propObj.foodIncluded = propObj.foodIncluded ?? propObj.pgDetails?.foodIncluded ?? false;
    propObj.foodInfo = propObj.foodInfo || propObj.pgDetails?.foodInfo || {};
    propObj.rules = propObj.rules || propObj.pgDetails?.rules || {};
    propObj.securityDeposit =
      propObj.securityDeposit ??
      propObj.pricing?.securityDeposit ??
      propObj.pgDetails?.roomConfigs?.[0]?.depositAmount ??
      0;
    propObj.noticePeriod = propObj.noticePeriod ?? propObj.pgDetails?.noticePeriod ?? 30;
    propObj.minStay = propObj.minStay ?? propObj.pgDetails?.minStay ?? 1;
    propObj.isAvailable = propObj.isAvailable ?? propObj.pgDetails?.isAvailable ?? true;
    propObj.propertyType = propObj.propertyType || propObj.pgDetails?.propertySubtype || 'PG';
    if (!propObj.minRent) {
      if (propObj.roomConfigs?.length > 0) {
        const rents = propObj.roomConfigs
          .map((rc) => Number(rc.rent))
          .filter((r) => !isNaN(r) && r > 0);
        if (rents.length > 0) propObj.minRent = Math.min(...rents);
      }
      if (!propObj.minRent && propObj.pricing?.expectedPrice) {
        propObj.minRent = propObj.pricing.expectedPrice;
      }
    }
    if (!propObj.rent && propObj.roomConfigs?.length > 0) {
      const rMap = {};
      propObj.roomConfigs.forEach((rc) => {
        const r = Number(rc.rent);
        if (!isNaN(r) && r > 0 && rc.shareType) rMap[rc.shareType] = r;
      });
      if (Object.keys(rMap).length > 0) propObj.rent = rMap;
    }
  } else {
    propObj.name = propObj.name || propObj.title;
    propObj.facilities = propObj.facilities || propObj.amenities || [];
    propObj.amenities = propObj.amenities || propObj.facilities || [];
  }

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
  sanitizePropertyPayload,
};

const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const Area = require('../models/Area.model');
const City = require('../models/City.model');

/**
 * Area Controller — dedicated to the PG owner area-search + findOrCreate flow.
 *
 * Endpoints:
 *  GET  /api/v1/areas            — search areas by cityId + optional text query
 *  POST /api/v1/areas/find-or-create — create if not exists, return existing if it does
 *
 * These endpoints accept a real City ObjectId (frontend resolves the name→id via
 * the /cities list it already fetches for the city selector).
 */

const mongoose = require('mongoose');

// In-memory area cache (5-minute TTL)
const _areaCache = new Map();
const AREA_CACHE_TTL = 5 * 60 * 1000;

const invalidateAreaCache = (cityId) => {
  if (cityId) {
    for (const key of _areaCache.keys()) {
      if (key.startsWith(String(cityId))) {
        _areaCache.delete(key);
      }
    }
  } else {
    _areaCache.clear();
  }
};

// ─── GET /api/v1/areas?cityId=<id>&city=<name>&q=<text> ───────────────────────
/**
 * @route   GET /api/v1/areas
 * @desc    Search active areas for a city, accepting cityId OR city name/slug.
 *          Returns up to 50 results sorted by order then name, with cached property counts.
 * @access  Public
 */
const searchAreas = asyncHandler(async (req, res) => {
  const { cityId, city: cityParam, cityName, q, limit: limitStr } = req.query;

  let resolvedCityId = null;
  let resolvedCityName = null;

  // 1. If cityId is provided and is a valid ObjectId, lookup by ID
  if (cityId && mongoose.Types.ObjectId.isValid(cityId)) {
    const cityDoc = await City.findById(cityId).select('_id name').lean();
    if (cityDoc) {
      resolvedCityId = cityDoc._id;
      resolvedCityName = cityDoc.name;
    }
  }

  // 2. If not resolved, search by name or slug (or if cityId was a city name string)
  if (!resolvedCityId) {
    const candidate = (cityParam || cityName || cityId || '').trim();
    if (candidate) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cityDoc = await City.findOne({
        $or: [
          { name: { $regex: new RegExp(`^${escaped}$`, 'i') } },
          { slug: candidate.toLowerCase() },
          { aliases: { $regex: new RegExp(`^${escaped}$`, 'i') } },
        ],
      }).select('_id name').lean();

      if (cityDoc) {
        resolvedCityId = cityDoc._id;
        resolvedCityName = cityDoc.name;
      }
    }
  }

  if (!resolvedCityId) {
    return errorResponse(res, 'Valid cityId or city name is required', 400);
  }

  const cleanQuery = (q || '').trim();
  const limit = Math.min(100, Math.max(1, parseInt(limitStr, 10) || 30));
  const cacheKey = `${resolvedCityId}:${cleanQuery.toLowerCase()}:${limit}`;

  const now = Date.now();
  const cached = _areaCache.get(cacheKey);
  if (cached && now - cached.timestamp < AREA_CACHE_TTL) {
    return successResponse(res, 'Areas retrieved (cached)', {
      areas: cached.data,
      city: { _id: resolvedCityId, name: resolvedCityName },
    });
  }

  const filter = { city: resolvedCityId, isActive: true };

  if (cleanQuery.length > 0) {
    filter.name = { $regex: cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }

  // When browsing all popular areas for a city without search query, load active areas to rank by property count
  const rawQuery = Area.find(filter).select('_id name slug order image isAutoCreated');
  if (cleanQuery.length > 0) {
    rawQuery.limit(limit);
  }
  const rawAreas = await rawQuery.lean();

  // Deduplicate areas by normalized name
  const seenAreaNames = new Set();
  const areas = [];
  for (const a of rawAreas) {
    const norm = (a.name || '').trim().toLowerCase();
    if (!seenAreaNames.has(norm)) {
      seenAreaNames.add(norm);
      areas.push(a);
    }
  }

  // Aggregate property & PG counts for resolved city
  let countMap = {};
  try {
    const PG = require('../models/PG.model');
    const Property = require('../models/Property.model');

    const [pgCounts, propCounts] = await Promise.allSettled([
      PG.aggregate([
        { $match: { city: resolvedCityName } },
        { $group: { _id: { $toLower: '$area' }, count: { $sum: 1 } } },
      ]),
      Property.aggregate([
        { $match: { city: resolvedCityName } },
        { $group: { _id: { $toLower: '$area' }, count: { $sum: 1 } } },
      ]),
    ]);

    if (pgCounts.status === 'fulfilled') {
      pgCounts.value.forEach((c) => {
        countMap[c._id] = (countMap[c._id] || 0) + c.count;
      });
    }

    if (propCounts.status === 'fulfilled') {
      propCounts.value.forEach((c) => {
        countMap[c._id] = Math.max(countMap[c._id] || 0, c.count);
      });
    }
  } catch (err) {
    console.warn('[AreaController] Failed to aggregate counts:', err.message);
  }

  const enrichedAreas = areas.map((area) => {
    const key = (area.name || '').trim().toLowerCase();
    const count = countMap[key] || 0;
    return {
      ...area,
      pgCount: count,
      propertyCount: count,
    };
  });

  // Sort areas that actually have properties first, then by admin order, then alphabetically
  enrichedAreas.sort((a, b) => {
    const countDiff = (b.propertyCount || 0) - (a.propertyCount || 0);
    if (countDiff !== 0) return countDiff;
    const orderDiff = (a.order || 99) - (b.order || 99);
    if (orderDiff !== 0) return orderDiff;
    return (a.name || '').localeCompare(b.name || '');
  });

  const finalAreas = enrichedAreas.slice(0, limit);

  _areaCache.set(cacheKey, { data: finalAreas, timestamp: now });

  return successResponse(res, 'Areas retrieved', {
    areas: finalAreas,
    city: { _id: resolvedCityId, name: resolvedCityName },
  });
});

// ─── POST /api/v1/areas/find-or-create ────────────────────────────────────────
/**
 * @route   POST /api/v1/areas/find-or-create
 * @desc    Idempotent area creation.
 *          - If an area with the same name (case-insensitive) already exists in
 *            the city → return it.
 *          - If it does not exist → create it and return the new document.
 *          This guarantees zero duplicate areas regardless of concurrency.
 * @access  Protected (any authenticated user — owners need to create areas on-the-fly)
 * @body    { cityId: string, name: string }
 */
const findOrCreateArea = asyncHandler(async (req, res) => {
  const { cityId, cityName: bodyCityName, city: bodyCityParam, name } = req.body;

  if ((!cityId && !bodyCityName && !bodyCityParam) || !name || !name.trim()) {
    return errorResponse(res, 'cityId (or city name) and area name are required', 400);
  }

  const trimmedName = name.trim();

  // Validate city exists and grab its name for the denormalized cityName field
  let cityDoc = null;
  if (cityId && mongoose.Types.ObjectId.isValid(cityId)) {
    cityDoc = await City.findById(cityId).select('_id name').lean();
  }
  if (!cityDoc) {
    const candidate = (bodyCityParam || bodyCityName || cityId || '').trim();
    if (candidate) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cityDoc = await City.findOne({
        $or: [
          { name: { $regex: new RegExp(`^${escaped}$`, 'i') } },
          { slug: candidate.toLowerCase() },
          { aliases: { $regex: new RegExp(`^${escaped}$`, 'i') } },
        ],
      }).select('_id name').lean();
    }
  }

  if (!cityDoc) {
    return errorResponse(res, 'City not found', 404);
  }

  const effectiveCityId = cityDoc._id;

  // Build the slug the same way Area.model.js does it (keep in sync)
  const slug = trimmedName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  // findOneAndUpdate with upsert is atomic — safe against race conditions.
  // $setOnInsert only runs on INSERT, so existing documents are never mutated.
  const area = await Area.findOneAndUpdate(
    {
      city: effectiveCityId,
      name: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    },
    {
      $setOnInsert: {
        city: effectiveCityId,
        cityName: cityDoc.name,
        name: trimmedName,
        slug,
        isActive: true,
        order: 99,
      },
    },
    {
      upsert: true,
      new: true,        // return the document (whether found or created)
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  invalidateAreaCache(effectiveCityId);

  // Mongoose upsert does not trigger pre-save hooks — slug is set manually above.
  const wasCreated = !area.createdAt || Date.now() - new Date(area.createdAt).getTime() < 5000;

  return successResponse(
    res,
    wasCreated ? 'Area created successfully' : 'Area already exists',
    { area },
    201
  );
});

module.exports = { searchAreas, findOrCreateArea };

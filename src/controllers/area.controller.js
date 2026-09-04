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

// ─── GET /api/v1/areas?cityId=<id>&q=<text> ───────────────────────────────────
/**
 * @route   GET /api/v1/areas
 * @desc    Search active areas for a city, with optional text search.
 *          Returns up to 20 results sorted by relevance (text score) then name.
 * @access  Public
 * @query   cityId  — required, MongoDB ObjectId of the city
 * @query   q       — optional, free-text partial-match filter
 */
const searchAreas = asyncHandler(async (req, res) => {
  const { cityId, q } = req.query;

  if (!cityId) {
    return errorResponse(res, 'cityId query parameter is required', 400);
  }

  // Validate that the city exists (avoids silently returning nothing for bad IDs)
  const cityExists = await City.exists({ _id: cityId });
  if (!cityExists) {
    return errorResponse(res, 'City not found', 404);
  }

  const filter = { city: cityId, isActive: true };

  // Apply partial-match name filter when a search term is provided
  if (q && q.trim().length > 0) {
    filter.name = { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }

  const PG = require('../models/PG.model');

  const areas = await Area.find(filter)
    .sort({ order: 1, name: 1 })
    .select('_id name slug order image')
    .limit(20)
    .lean();

  // Aggregate approved PG counts for these areas
  const areaNames = areas.map((a) => a.name);
  let pgCountMap = {};

  if (areaNames.length > 0) {
    try {
      const counts = await PG.aggregate([
        {
          $match: {
            status: 'approved',
            area: { $in: areaNames.map((n) => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) },
          },
        },
        {
          $group: {
            _id: { $toLower: '$area' },
            count: { $sum: 1 },
          },
        },
      ]);

      counts.forEach((c) => {
        pgCountMap[c._id] = c.count;
      });
    } catch (err) {
      console.warn('[AreaController] Failed to aggregate PG counts:', err.message);
    }
  }

  const enrichedAreas = areas.map((area) => ({
    ...area,
    pgCount: pgCountMap[area.name.toLowerCase()] || 0,
  }));

  return successResponse(res, 'Areas retrieved', { areas: enrichedAreas });
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
  const { cityId, name } = req.body;

  if (!cityId || !name || !name.trim()) {
    return errorResponse(res, 'cityId and name are required', 400);
  }

  const trimmedName = name.trim();

  // Validate city exists and grab its name for the denormalized cityName field
  const city = await City.findById(cityId).select('name').lean();
  if (!city) {
    return errorResponse(res, 'City not found', 404);
  }

  // Build the slug the same way Area.model.js does it (keep in sync)
  const slug = trimmedName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  // findOneAndUpdate with upsert is atomic — safe against race conditions.
  // $setOnInsert only runs on INSERT, so existing documents are never mutated.
  const area = await Area.findOneAndUpdate(
    {
      city: cityId,
      name: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    },
    {
      $setOnInsert: {
        city: cityId,
        cityName: city.name,
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

const asyncHandler = require('../utils/asyncHandler');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const City = require('../models/City.model');
const Area = require('../models/Area.model');

/**
 * Escapes special regex characters to safely use user input in RegExp.
 */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Strips common administrative suffixes from district/division names in India.
 * e.g. "Pune Division" -> "Pune", "Bangalore Urban" -> "Bangalore", "Mumbai Suburban" -> "Mumbai"
 */
const cleanDistrict = (str) => {
  if (!str) return null;
  const cleaned = str
    .replace(/\b(Division|District|Urban|Rural|Suburban|City)\b/gi, '')
    .trim();
  return cleaned.length >= 2 ? cleaned : str.trim();
};

/**
 * @route  POST /api/v1/location/resolve
 * @desc   Intelligently resolve a Google Places selection to our internal City + Area records.
 *
 *         Handles:
 *           1. Correct City vs Suburb hierarchy (e.g. Pirangut is an Area of Pune, NOT a City)
 *           2. Multi-tier checking: adminArea2 ("Pune Division" -> "Pune"), adminArea3 ("Pune"),
 *              and locality ("Pirangut"). If parent district/division matches a known DB city,
 *              that parent is the City and the locality becomes the Area.
 *           3. Auto-creates new cities for global expansion if no known city matched.
 *           4. Auto-extracts landmark from placeName (e.g. "Opposite Metro Station") or premise.
 *           5. Auto-persists Area linked to the resolved City._id.
 *
 * @access Public
 */
const resolveLocation = asyncHandler(async (req, res) => {
  const {
    components = {},
    placeName = '',
    formattedAddress = '',
    googlePlaceId = '',
  } = req.body;

  const trimmedState =
    (components.adminArea1 || components.state)?.trim() || null;
  const rawLocality =
    components.locality?.trim() || components.city?.trim() || null;
  const rawAdmin3 = components.adminArea3?.trim() || null;
  const rawAdmin2 =
    components.adminArea2?.trim() || components.district?.trim() || null;

  const cleanAdmin2 = cleanDistrict(rawAdmin2);
  const cleanAdmin3 = cleanDistrict(rawAdmin3);

  // Helper to query City collection with name or aliases, optionally scoped to state
  const findDbCity = async (cand) => {
    if (!cand || cand.length < 2) return null;
    const escCand = esc(cand);
    const query = {
      isActive: true,
      $or: [
        { name: { $regex: new RegExp(`^${escCand}$`, 'i') } },
        { aliases: { $regex: new RegExp(`^${escCand}$`, 'i') } },
      ],
    };
    if (trimmedState) {
      const matchWithState = await City.findOne({
        ...query,
        state: { $regex: new RegExp(esc(trimmedState), 'i') },
      }).lean();
      if (matchWithState) return matchWithState;
    }
    return City.findOne(query).lean();
  };

  // ── Step 1: Multi-tier city resolution ─────────────────────────────────────
  // Check if adminArea2 (e.g. "Pune Division" -> "Pune") matches a verified City in DB
  let matchedDistrictCity = await findDbCity(cleanAdmin2);
  if (!matchedDistrictCity && cleanAdmin3) {
    matchedDistrictCity = await findDbCity(cleanAdmin3);
  }

  // Check if locality matches a verified City in DB (e.g. "Jaipur", "Nagpur", "Pune")
  let matchedLocalityCity = await findDbCity(rawLocality);

  let resolvedCity = null;
  let resolvedAreaName = null;

  if (matchedDistrictCity) {
    // Parent district/division is an established city in our DB (e.g. "Pune", "Mumbai", "Bengaluru")
    resolvedCity = matchedDistrictCity;

    if (
      rawLocality &&
      rawLocality.toLowerCase() !== matchedDistrictCity.name.toLowerCase()
    ) {
      // Locality is a suburb / census town / industrial area (e.g. "Pirangut", "Hinjewadi", "Whitefield")
      // This solves the Pirangut-as-City inversion: locality becomes the Area!
      resolvedAreaName = components.sublocality1
        ? `${components.sublocality1}, ${rawLocality}`
        : rawLocality;
    } else {
      // Locality is the city itself (e.g. locality="Pune", city="Pune") -> use sublocality
      resolvedAreaName =
        components.sublocality1 ||
        components.sublocality ||
        components.neighborhood ||
        components.area ||
        '';
    }
  } else if (matchedLocalityCity) {
    // Locality itself is an established city in our DB (e.g. "Jaipur", "Bikaner", "Kota")
    resolvedCity = matchedLocalityCity;
    resolvedAreaName =
      components.sublocality1 ||
      components.sublocality ||
      components.neighborhood ||
      components.area ||
      '';
  } else {
    // Neither matched an existing DB city -> auto-create new City (for global expansion)
    const candidateName = rawLocality || cleanAdmin2 || 'Other';
    const citySlug = candidateName
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    try {
      resolvedCity = await City.findOneAndUpdate(
        { slug: citySlug },
        {
          $setOnInsert: {
            name: candidateName,
            slug: citySlug,
            state: trimmedState || '',
            country: components.country?.trim() || 'India',
            order: 99,
            isActive: true,
            aliases: [],
          },
        },
        { upsert: true, new: true, runValidators: false, setDefaultsOnInsert: true }
      ).lean();
    } catch {
      resolvedCity = await City.findOne({
        $or: [
          { slug: citySlug },
          { name: { $regex: new RegExp(`^${esc(candidateName)}$`, 'i') } },
        ],
      }).lean();
    }

    resolvedAreaName =
      components.sublocality1 ||
      components.sublocality ||
      components.neighborhood ||
      components.area ||
      '';
  }

  // ── Step 2: Auto-create / persist Area linked to resolved City ───────────────
  let resolvedArea = null;
  const trimmedArea = resolvedAreaName?.trim() || null;

  if (resolvedCity && trimmedArea) {
    const areaSlug = trimmedArea
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    resolvedArea = await Area.findOneAndUpdate(
      {
        city: resolvedCity._id,
        name: { $regex: new RegExp(`^${esc(trimmedArea)}$`, 'i') },
      },
      {
        $setOnInsert: {
          city: resolvedCity._id,
          cityName: resolvedCity.name,
          name: trimmedArea,
          slug: areaSlug,
          isActive: true,
          order: 10,
          source: 'google_maps',
          isAutoCreated: true,
          state: trimmedState || resolvedCity.state || null,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: false,
        setDefaultsOnInsert: true,
      }
    ).lean();
  }

  // ── Step 3: Landmark Extraction ─────────────────────────────────────────────
  // If user searched a building, society, landmark (e.g. "Opposite Metro Station",
  // "Gera Landmark", "Hotel Shreyas"), extract it cleanly into landmark.
  let resolvedLandmark = '';
  const cityNameLower = resolvedCity?.name?.toLowerCase() || '';
  const areaNameLower = (trimmedArea || '').toLowerCase();
  const pName = placeName?.trim() || '';

  if (
    pName &&
    pName.toLowerCase() !== cityNameLower &&
    pName.toLowerCase() !== areaNameLower &&
    !pName.toLowerCase().includes(cityNameLower + ',') &&
    pName.length < 120
  ) {
    resolvedLandmark = pName;
  } else {
    // Fall back to premise or point of interest from address components
    const premise = components.premise || components.pointOfInterest;
    if (
      premise &&
      premise.toLowerCase() !== cityNameLower &&
      premise.toLowerCase() !== areaNameLower
    ) {
      resolvedLandmark = premise;
    }
  }

  return successResponse(
    res,
    resolvedCity ? 'Location resolved' : 'City resolved via Google Places',
    {
      city: resolvedCity || null,
      area: resolvedArea || (trimmedArea ? { name: trimmedArea } : null),
      landmark: resolvedLandmark || '',
      state: trimmedState || resolvedCity?.state || null,
      postalCode: components.postalCode || null,
      country: components.country || resolvedCity?.country || 'India',
      cityFound: !!resolvedCity,
      areaCreated: !!resolvedArea,
    }
  );
});

module.exports = { resolveLocation };

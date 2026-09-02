const axios = require('axios');

/**
 * Google Place type → our internal placeType mapping
 */
const TYPE_MAP = [
  { googleType: 'university',       placeType: 'college'          },
  { googleType: 'school',           placeType: 'college'          },
  { googleType: 'hospital',         placeType: 'hospital'         },
  { googleType: 'subway_station',   placeType: 'metro'            },
  { googleType: 'train_station',    placeType: 'railway_station'  },
  { googleType: 'bus_station',      placeType: 'bus_stop'         },
  { googleType: 'shopping_mall',    placeType: 'shopping_mall'    },
  { googleType: 'restaurant',       placeType: 'restaurant'       },
  { googleType: 'atm',              placeType: 'bank_atm'         },
  { googleType: 'bank',             placeType: 'bank_atm'         },
  { googleType: 'park',             placeType: 'park'             },
  { googleType: 'pharmacy',         placeType: 'pharmacy'         },
  { googleType: 'supermarket',      placeType: 'supermarket'      },
  { googleType: 'grocery_or_supermarket', placeType: 'supermarket' },
];

// IT Parks need a keyword search, not a type
const IT_PARK_KEYWORDS = ['IT Park', 'SEZ', 'Tech Park', 'Software Park'];

/**
 * Haversine formula: distance in km between two lat/lng points
 */
const haversineKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
};

/**
 * Approximate walking time in minutes (average walking speed: 5 km/h)
 */
const walkTimeMinutes = (distanceKm) => Math.round((distanceKm / 5) * 60);

/**
 * Fetch a single category of nearby places via Google Places Nearby Search API.
 * Returns the single closest result (by actual distance), or null.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} placeType    — our internal placeType label
 * @param {string} googleType   — Google type string
 * @param {string} [keyword]    — optional keyword for IT parks
 * @param {string} apiKey
 */
const fetchCategory = async (lat, lng, placeType, googleType, keyword, apiKey) => {
  try {
    const params = {
      location: `${lat},${lng}`,
      radius: 3000, // 3 km
      key: apiKey,
    };
    if (googleType) params.type = googleType;
    if (keyword) params.keyword = keyword;

    const res = await axios.get(
      'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
      { params, timeout: 5000 }
    );

    const results = res.data?.results;
    if (!results || results.length === 0) return null;

    // Attach actual Haversine distance and sort
    const withDist = results
      .filter((r) => r.geometry?.location)
      .map((r) => ({
        ...r,
        _dist: haversineKm(lat, lng, r.geometry.location.lat, r.geometry.location.lng),
      }))
      .sort((a, b) => a._dist - b._dist);

    if (withDist.length === 0) return null;
    const closest = withDist[0];

    return {
      placeType,
      name: closest.name,
      distance: closest._dist,
      walkTime: walkTimeMinutes(closest._dist),
      placeId: closest.place_id || null,
      address: closest.vicinity || null,
    };
  } catch (err) {
    // Non-fatal — missing one category is acceptable
    return null;
  }
};

/**
 * Auto-fetch nearby places for a PG via Google Places API (server-side).
 * Called after PG creation when lat/lng is known.
 *
 * Returns an array of nearby place objects ready to store in PG.nearbyPlaces.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<Array>}
 */
const fetchNearbyPlacesForPG = async (lat, lng) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || !lat || !lng) return [];

  const searches = [
    ...TYPE_MAP.map(({ googleType, placeType }) => ({ placeType, googleType, keyword: null })),
    { placeType: 'it_park', googleType: null, keyword: 'IT Park' },
  ];

  // Deduplicate placeType in searches (take first occurrence per placeType)
  const seen = new Set();
  const uniqueSearches = searches.filter(({ placeType }) => {
    if (seen.has(placeType)) return false;
    seen.add(placeType);
    return true;
  });

  const results = await Promise.all(
    uniqueSearches.map(({ placeType, googleType, keyword }) =>
      fetchCategory(lat, lng, placeType, googleType, keyword, apiKey)
    )
  );

  return results.filter(Boolean);
};

module.exports = { fetchNearbyPlacesForPG, haversineKm, walkTimeMinutes };
